import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanReleasePrivacy } from "../release-privacy.mjs";

const projectDir = process.env.PRIVACY_TEST_TOOLS || path.resolve("apps/reader");
const requireTools = createRequire(path.join(projectDir, "package.json"));
const asar = requireTools("@electron/asar");

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

test("real ASAR inspection handles Windows listings without changing member names", async (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.payload, "nested/clean.js"), "export const authored = true;");
  await asar.createPackage(f.payload, f.archive);
  const report = await scanReleasePrivacy(f.archive, { projectDir: f.tools });
  assert.equal(report.status, "PASS");
  assert.equal(report.filesScanned, 2);
});

test("ASAR inspection still sees nested credentials and never prints their values", async (t) => {
  const f = fixture(t);
  const secret = ["ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
  writeFileSync(path.join(f.payload, "nested/clean.js"), `const token = '${secret}';`);
  await asar.createPackage(f.payload, f.archive);
  const report = await scanReleasePrivacy(f.archive, { projectDir: f.tools });
  assert.equal(report.status, "FAIL");
  assert(report.findings.some((item) => item.file.endsWith("runtime.asar!/nested/clean.js")));
  assert(!JSON.stringify(report).includes(secret));
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
  writeFileSync(reference, JSON.stringify({ node: {}, edge: {}, encryptionKey: Buffer.alloc(32, 42).toString("base64") }));
  writeFileSync(path.join(next, "prerender-manifest.json"), JSON.stringify({ version: 4, routes: { "/favicon.ico": {} }, dynamicRoutes: {}, preview }));
  writeFileSync(path.join(next, "server/preview-props.json"), JSON.stringify(preview));
  const resources = path.join(f.root, "resources");
  mkdirSync(resources);
  const archive = path.join(resources, "runtime.asar");
  const options = { projectDir, profile: "desktop" };
  const pack = () => asar.createPackage(f.payload, archive);
  await pack();
  assert.equal((await scanReleasePrivacy(f.payload, options)).status, "PASS");
  assert.equal((await scanReleasePrivacy(archive, options)).status, "PASS");
  assert.equal((await scanReleasePrivacy(resources, { projectDir })).status, "FAIL");
  assert.equal((await scanReleasePrivacy(resources, options)).status, "PASS");

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

test("raw ASAR header components cannot hide separators or traversal behind library normalization", async (t) => {
  for (const invalid of ["dir/a.js", "../ab.js", "bad\\x.js"]) {
    const f = fixture(t);
    writeFileSync(path.join(f.payload, "clean.js"), "authored");
    await asar.createPackage(f.payload, f.archive);
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
  await asar.createPackage(f.payload, f.archive);
  assert.equal((await scanReleasePrivacy(f.archive, { projectDir })).status, "PASS");
  rmSync(clean);
  writeFileSync(path.join(f.payload, "nested/private.log"), "authored");
  const replacement = path.join(f.root, "replacement.asar");
  await asar.createPackage(f.payload, replacement);
  copyFileSync(replacement, f.archive);
  const report = await scanReleasePrivacy(f.archive, { projectDir });
  assert.equal(report.status, "FAIL");
  assert(report.findings.some((item) => item.file.endsWith("runtime.asar!/nested/private.log")));
});

test("truncated ASAR members cannot be reported as zero-padded complete scans", async (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.payload, "nested/clean.js"), "authored original bytes");
  await asar.createPackage(f.payload, f.archive);
  const bytes = readFileSync(f.archive);
  writeFileSync(f.archive, bytes.subarray(0, bytes.length - 5));
  await assert.rejects(scanReleasePrivacy(f.archive, { projectDir }), /ASAR member range/);
});
