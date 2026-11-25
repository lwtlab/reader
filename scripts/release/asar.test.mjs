import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { scanReleasePrivacy } from "../release-privacy.mjs";

const projectDir = process.env.PRIVACY_TEST_TOOLS || path.resolve("apps/reader");
const requireTools = createRequire(path.join(projectDir, "package.json"));
const asar = requireTools("@electron/asar");

// asar 3.x can resolve before its stream has finished, particularly on Windows.
// Remove an earlier generation first so its complete header cannot satisfy the wait.
async function packFixture(source, destination) {
  asar.uncache(destination);
  rmSync(destination, { force: true });
  await asar.createPackage(source, destination);
  const deadline = Date.now() + 30000;
  const packedEnd = (tree) =>
    Object.values(tree).reduce(
      (end, entry) =>
        entry.files
          ? Math.max(end, packedEnd(entry.files))
          : entry.unpacked
            ? end
            : Math.max(end, Number(entry.offset) + entry.size),
      0,
    );
  while (Date.now() < deadline) {
    try {
      const { header, headerSize } = asar.getRawHeader(destination);
      if (statSync(destination).size === 8 + headerSize + packedEnd(header.files)) return;
    } catch {
      /* The writer may not have completed the header yet. */
    }
    await delay(10);
  }
  throw new Error("Authored ASAR fixture did not finish writing");
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "privacy-asar-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const payload = path.join(root, "payload");
  mkdirSync(path.join(payload, "nested"), { recursive: true });
  const tools = path.join(root, "tools");
  mkdirSync(path.join(tools, "node_modules/@electron/asar"), { recursive: true });
  writeFileSync(path.join(tools, "package.json"), "{}");
  writeFileSync(
    path.join(tools, "node_modules/@electron/asar/index.js"),
    `
const original = require(${JSON.stringify(requireTools.resolve("@electron/asar"))});
module.exports = { ...original, listPackage(file) {
  return original.listPackage(file).map(name => name.replaceAll('/', String.fromCharCode(92)));
}};
`,
  );
  return { root, payload, tools, archive: path.join(root, "runtime.asar") };
}

test("ASAR fixtures await delayed tails and cannot consume a previous generation", async (t) => {
  const f = fixture(t);
  const source = path.join(f.payload, "nested/clean.js");
  writeFileSync(source, "export const authored = 'previous';");
  await packFixture(f.payload, f.archive);
  writeFileSync(source, "export const authored = 'next complete generation';");
  const next = path.join(f.root, "next.asar");
  await packFixture(f.payload, next);
  const bytes = readFileSync(next);
  const { headerSize } = asar.getRawHeader(next);
  const split = 8 + headerSize;
  const original = asar.createPackage;
  asar.createPackage = async (_source, destination) => {
    setTimeout(() => {
      writeFileSync(destination, bytes.subarray(0, split));
      setTimeout(() => appendFileSync(destination, bytes.subarray(split)), 20);
    }, 10);
  };
  try {
    await packFixture(f.payload, f.archive);
    assert.deepEqual(readFileSync(f.archive), bytes);
    assert.equal((await scanReleasePrivacy(f.archive, { projectDir })).status, "PASS");
  } finally {
    asar.createPackage = original;
  }
});

test("real ASAR inspection handles Windows listings without changing member names", async (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.payload, "nested/clean.js"), "export const authored = true;");
  await packFixture(f.payload, f.archive);
  const report = await scanReleasePrivacy(f.archive, { projectDir: f.tools });
  assert.equal(report.status, "PASS");
  assert.equal(report.filesScanned, 2);
});

test("ASAR inspection still sees nested credentials and never prints their values", async (t) => {
  const f = fixture(t);
  const secret = ["ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
  writeFileSync(path.join(f.payload, "nested/clean.js"), `const token = '${secret}';`);
  await packFixture(f.payload, f.archive);
  const report = await scanReleasePrivacy(f.archive, { projectDir: f.tools });
  assert.equal(report.status, "FAIL");
  assert(report.findings.some((item) => item.file.endsWith("runtime.asar!/nested/clean.js")));
  assert(!JSON.stringify(report).includes(secret));
});

test("blocked ASAR diagnostics contain only bounded member positions and digests", async (t) => {
  const f = fixture(t);
  const value = createHash("sha256").update("authored-asar-diagnostic").digest("hex");
  const source = `const apiKey='${value}';`;
  const member = "nested/unreviewed.js";
  writeFileSync(path.join(f.payload, member), source);
  const resources = path.join(f.root, "resources");
  mkdirSync(resources);
  const archive = path.join(resources, "runtime.asar");
  await packFixture(f.payload, archive);
  const diagnostics = [];
  const report = await scanReleasePrivacy(resources, {
    projectDir,
    onAsarUnclassifiedMatch: (record) => diagnostics.push(record),
  });
  assert.equal(report.status, "FAIL");
  const diagnostic = diagnostics.find(
    (row) => row.secretSha256 === createHash("sha256").update(value).digest("hex"),
  );
  assert.ok(diagnostic);
  assert.equal(diagnostic.count, 1);
  assert.equal(diagnostic.truncated, false);
  assert.deepEqual(diagnostic.occurrences, [
    {
      member,
      fileSha256: createHash("sha256").update(source).digest("hex"),
      offset: source.indexOf(value),
      classified: false,
    },
  ]);
  assert.ok(!JSON.stringify(diagnostics).includes(value));
  rmSync(path.join(f.payload, member));
  writeFileSync(path.join(f.payload, "nested/a.txt"), `const apiKey='${value.slice(0, 32)}`);
  writeFileSync(path.join(f.payload, "nested/b.txt"), `${value.slice(32)}';`);
  await packFixture(f.payload, archive);
  diagnostics.length = 0;
  assert.equal(
    (
      await scanReleasePrivacy(resources, {
        projectDir,
        onAsarUnclassifiedMatch: (record) => diagnostics.push(record),
      })
    ).status,
    "FAIL",
  );
  const crossing = diagnostics.find(
    (row) => row.secretSha256 === createHash("sha256").update(value).digest("hex"),
  );
  assert.ok(crossing);
  assert.equal(crossing.occurrences[0].member, null);
  assert.deepEqual(
    crossing.occurrences[0].boundaryMembers.map((item) => item.member),
    ["nested/a.txt", "nested/b.txt"],
  );
  assert.ok(!JSON.stringify(diagnostics).includes(value));
  assert.ok(!JSON.stringify(diagnostics).includes(source));
  assert.ok(!JSON.stringify(diagnostics).includes(f.root));
  rmSync(path.join(f.payload, "nested/a.txt"));
  rmSync(path.join(f.payload, "nested/b.txt"));
  writeFileSync(path.join(f.payload, member), Array(40).fill(source).join("\n"));
  await packFixture(f.payload, archive);
  diagnostics.length = 0;
  assert.equal(
    (
      await scanReleasePrivacy(resources, {
        projectDir,
        onAsarUnclassifiedMatch: (record) => diagnostics.push(record),
      })
    ).status,
    "FAIL",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].count, 40);
  assert.equal(diagnostics[0].occurrences.length, 32);
  assert.equal(diagnostics[0].truncated, true);
  assert.ok(!JSON.stringify(diagnostics).includes(value));
});

test("packaged ASAR uses classified member bytes without exempting header, tail or other members", async (t) => {
  const f = fixture(t);
  const next = path.join(f.payload, "apps/reader/.next");
  mkdirSync(path.join(next, "server"), { recursive: true });
  const key = (label) => createHash("sha256").update(`authored-preview-${label}`).digest("hex");
  const preview = {
    previewModeId: "1".repeat(32),
    previewModeSigningKey: key("signing"),
    previewModeEncryptionKey: key("encryption"),
  };
  const reference = path.join(next, "server/server-reference-manifest.json");
  const referenceData = {
    node: {},
    edge: {},
    encryptionKey: createHash("sha256").update("authored-action-key").digest("base64"),
  };
  writeFileSync(reference, JSON.stringify(referenceData));
  const referenceCopy = path.join(next, "server/server-reference-manifest.js");
  const wrapper = `self.__RSC_SERVER_MANIFEST=${JSON.stringify(JSON.stringify(referenceData))}`;
  writeFileSync(referenceCopy, wrapper);
  writeFileSync(
    path.join(next, "prerender-manifest.json"),
    JSON.stringify({ version: 4, routes: { "/favicon.ico": {} }, dynamicRoutes: {}, preview }),
  );
  writeFileSync(path.join(next, "server/preview-props.json"), JSON.stringify(preview));
  const resources = path.join(f.root, "resources");
  mkdirSync(resources);
  const archive = path.join(resources, "runtime.asar");
  const options = { projectDir, profile: "desktop" };
  const pack = () => packFixture(f.payload, archive);
  await pack();
  assert.equal((await scanReleasePrivacy(f.payload, options)).status, "PASS");
  assert.equal((await scanReleasePrivacy(archive, options)).status, "PASS");
  assert.equal((await scanReleasePrivacy(resources, { projectDir })).status, "FAIL");
  assert.equal((await scanReleasePrivacy(resources, options)).status, "PASS");

  writeFileSync(referenceCopy, `${wrapper};globalThis.unreviewed=true;`);
  await pack();
  assert.equal((await scanReleasePrivacy(resources, options)).status, "FAIL");
  writeFileSync(referenceCopy, wrapper);
  await pack();

  // An identical previously classified value outside a member has no proof.
  appendFileSync(archive, `\nconst apiKey = '${preview.previewModeSigningKey}';`);
  assert.equal((await scanReleasePrivacy(resources, options)).status, "FAIL");
  await pack();
  const raw = asar.getRawHeader(archive);
  const payload = readFileSync(archive).subarray(8 + raw.headerSize);
  raw.header.authoredMetadata = { apiKey: preview.previewModeSigningKey };
  const { Pickle } = createRequire(requireTools.resolve("@electron/asar"))("./pickle");
  const header = Pickle.createEmpty();
  header.writeString(JSON.stringify(raw.header));
  const size = Pickle.createEmpty();
  size.writeUInt32(header.toBuffer().length);
  writeFileSync(archive, Buffer.concat([size.toBuffer(), header.toBuffer(), payload]));
  assert.equal((await scanReleasePrivacy(resources, options)).status, "FAIL");

  const extra = path.join(f.payload, "nested/unreviewed.js");
  writeFileSync(extra, `const apiKey = '${preview.previewModeSigningKey}';`);
  await pack();
  assert.equal((await scanReleasePrivacy(resources, options)).status, "FAIL");
  rmSync(extra);
  writeFileSync(reference, JSON.stringify({ node: { action: {} }, edge: {} }));
  await pack();
  assert.equal((await scanReleasePrivacy(resources, options)).status, "FAIL");
});

test("reviewed fragment approval binds the complete file and cannot bless dependency copies", async (t) => {
  const f = fixture(t);
  const source =
    "const apiKey='" + createHash("sha256").update("authored-provenance-only").digest("hex") + "';";
  const value = source.split("'")[1];
  const name = "nested/reviewed.js";
  const file = path.join(f.payload, name);
  writeFileSync(file, source);
  const policyRoot = path.join(f.root, "policy");
  for (const relative of [
    "scripts/release-privacy.mjs",
    "scripts/release/privacy-gitleaks.toml",
    "scripts/release/privacy-public-data.json",
    "scripts/release/hermes-strings.mjs",
  ]) {
    const target = path.join(policyRoot, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.resolve(import.meta.dirname, "../..", relative), target);
  }
  const policyFile = path.join(policyRoot, "scripts/release/privacy-public-data.json");
  const policy = JSON.parse(readFileSync(policyFile));
  policy.matches.push({
    id: "authored-exact-file",
    rule: "generic-api-key",
    suffix: name,
    sha256: createHash("sha256").update(value).digest("hex"),
    fileSha256: createHash("sha256").update(source).digest("hex"),
  });
  writeFileSync(policyFile, JSON.stringify(policy));
  const { scanReleasePrivacy: scan } = await import(
    pathToFileURL(path.join(policyRoot, "scripts/release-privacy.mjs"))
  );
  assert.equal((await scan(f.payload, { projectDir })).status, "PASS");
  appendFileSync(file, "\n// changed bytes invalidate the review\n");
  assert.equal((await scan(f.payload, { projectDir })).status, "FAIL");
  writeFileSync(file, source);
  const resources = path.join(f.root, "resources");
  mkdirSync(resources);
  const archive = path.join(resources, "runtime.asar");
  await packFixture(f.payload, archive);
  assert.equal((await scan(resources, { projectDir })).status, "PASS");
  const dependency = path.join(f.payload, "node_modules/unreviewed/index.js");
  mkdirSync(path.dirname(dependency), { recursive: true });
  writeFileSync(dependency, source);
  await packFixture(f.payload, archive);
  assert.equal((await scan(resources, { projectDir })).status, "FAIL");
});

test("raw ASAR header components cannot hide separators or traversal behind library normalization", async (t) => {
  for (const invalid of ["dir/a.js", "../ab.js", "bad\\x.js"]) {
    const f = fixture(t);
    writeFileSync(path.join(f.payload, "clean.js"), "authored");
    await packFixture(f.payload, f.archive);
    const header = asar.getRawHeader(f.archive).header;
    header.files[invalid] = header.files["clean.js"];
    delete header.files["clean.js"];
    const { Pickle } = createRequire(requireTools.resolve("@electron/asar"))("./pickle");
    const body = Pickle.createEmpty();
    body.writeString(JSON.stringify(header));
    const size = Pickle.createEmpty();
    size.writeUInt32(body.toBuffer().length);
    writeFileSync(
      f.archive,
      Buffer.concat([size.toBuffer(), body.toBuffer(), Buffer.from("authored")]),
    );
    asar.uncache(f.archive);
    await assert.rejects(
      scanReleasePrivacy(f.archive, { projectDir: f.tools }),
      /Unsafe ASAR entry/,
    );
  }
});

test("ASAR audits discard cached headers when exact candidate bytes change", async (t) => {
  const f = fixture(t);
  const clean = path.join(f.payload, "nested/clean.js");
  writeFileSync(clean, "authored");
  await packFixture(f.payload, f.archive);
  assert.equal((await scanReleasePrivacy(f.archive, { projectDir })).status, "PASS");
  rmSync(clean);
  writeFileSync(path.join(f.payload, "nested/private.log"), "authored");
  const replacement = path.join(f.root, "replacement.asar");
  await packFixture(f.payload, replacement);
  copyFileSync(replacement, f.archive);
  const report = await scanReleasePrivacy(f.archive, { projectDir });
  assert.equal(report.status, "FAIL");
  assert(report.findings.some((item) => item.file.endsWith("runtime.asar!/nested/private.log")));
});

test("truncated ASAR members cannot be reported as zero-padded complete scans", async (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.payload, "nested/clean.js"), "authored original bytes");
  await packFixture(f.payload, f.archive);
  const bytes = readFileSync(f.archive);
  writeFileSync(f.archive, bytes.subarray(0, bytes.length - 5));
  await assert.rejects(scanReleasePrivacy(f.archive, { projectDir }), /ASAR member range/);
});
