import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { encryptLog } from "./log-crypto.mjs";
import { binding, digest, positive } from "./reader-verification.mjs";

const allowedFiles = ["key.pem", "known_hosts", "scope.json"];
export function childEnvironment(ambient = process.env) {
  const names = new Set([
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "PROGRAMDATA",
    "ALLUSERSPROFILE",
    "TEMP",
    "TMP",
    "RUNNER_TEMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "PSMODULEPATH",
    "OS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "NUMBER_OF_PROCESSORS",
  ]);
  const env = Object.fromEntries(
    Object.entries(ambient).filter(([name]) => names.has(name.toUpperCase())),
  );
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "NUL",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}
export function sshCommand(executable, key, hosts) {
  const quoted = (p) => {
    assert(!/[\0\r\n'"]/.test(p));
    return `'${p.replaceAll("\\", "/")}'`;
  };
  // Paths on the managed runner cannot contain quotes; retain quotes for SSH's
  // option parser as well as the shell when a temp path contains spaces.
  const option = (name) => `'${name}="${hosts.replaceAll("\\", "/")}"'`;
  quoted(hosts);
  return `${quoted(executable)} -F none -i ${quoted(key)} -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o AddKeysToAgent=no -o ForwardAgent=no -o UpdateHostKeys=no -o StrictHostKeyChecking=yes -o CheckHostIP=no -o ConnectTimeout=30 -o ConnectionAttempts=1 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -o ${option("UserKnownHostsFile")} -o ${option("GlobalKnownHostsFile")}`;
}
export function verifyCommit(bytes, value) {
  const lines = bytes.toString().split(/\r?\n/),
    separator = lines.indexOf("");
  assert(separator >= 1);
  const headers = lines.slice(0, separator);
  assert(headers[0]?.startsWith("tree "));
  const parents = headers.filter((l) => l.startsWith("parent ")).map((l) => l.slice(7));
  if (value.pr) assert.deepEqual(parents, [value.base, value.head]);
  else assert.equal(value.tested, value.head);
}
async function main() {
  assert.equal(process.platform, "win32");
  const operation = process.argv[2];
  assert(["checkout", "controls", "cleanup", "seal"].includes(operation));
  const value = binding(JSON.parse(process.env.VERIFICATION_BINDING)),
    run = positive(process.env.GITHUB_RUN_ID),
    attempt = positive(process.env.GITHUB_RUN_ATTEMPT),
    platform = process.env.NATIVE_PLATFORM;
  assert(["windows-x64-cpu", "windows-arm64-cpu"].includes(platform));
  const root = realpathSync(process.cwd()),
    temp = realpathSync(process.env.RUNNER_TEMP),
    output = path.join(root, "native-tts-output");
  const outputFresh = !existsSync(output);
  mkdirSync(output, { recursive: true });
  const stateFile = path.join(output, "source-auth-state.json"),
    log = path.join(temp, "reader-private-build.log"),
    aclScript = path.join(root, "ci/reader-native-source-acl.ps1");
  const secret = process.env.READER_NATIVE_SOURCE_SSH_KEY;
  delete process.env.READER_NATIVE_SOURCE_SSH_KEY;
  const safe = childEnvironment(),
    identity = { run, attempt, platform, binding: value };
  let logReady = false;
  const capture = (command, args, { env = {}, expectedFailure = false, record = true } = {}) => {
    const result = spawnSync(command, args, {
      cwd: root,
      env: { ...safe, ...env },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (record && logReady) {
      const bytes = Buffer.from((result.stdout ?? "") + (result.stderr ?? ""));
      assert((existsSync(log) ? lstatSync(log).size : 0) + bytes.length <= 64 * 1024 * 1024);
      appendFileSync(log, bytes);
    }
    if ((result.error || result.status !== 0 || result.signal) && logReady && !record)
      appendFileSync(log, Buffer.from(result.stderr ?? ""));
    if (!expectedFailure)
      assert(!result.error && result.status === 0 && !result.signal, "TRUSTED_CHILD_FAILED");
    return result;
  };
  const permissions = (file, mode = "inspect") =>
    JSON.parse(
      capture("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", aclScript, mode], {
        env: { READER_NATIVE_ACL_TARGET: file },
        record: false,
      }).stdout,
    );
  const regular = (file) => {
    const s = lstatSync(file);
    assert(s.isFile() && !s.isSymbolicLink());
  };
  const privateFile = (file) => {
    writeFileSync(file, "", { flag: "wx", mode: 0o600 });
    assert.equal(permissions(file, "file").currentUserOnly, true);
  };
  const put = (file, text) => {
    regular(file);
    assert.equal(permissions(file).currentUserOnly, true);
    writeFileSync(file, text, { flag: "r+" });
    assert.equal(permissions(file).currentUserOnly, true);
  };
  const state = () => JSON.parse(readFileSync(stateFile));
  const clean = () => {
    if (!existsSync(stateFile)) return;
    assert.equal(permissions(output).currentUserOnly, true);
    regular(stateFile);
    assert.equal(permissions(stateFile).currentUserOnly, true);
    const saved = state();
    assert.deepEqual(Object.keys(saved).sort(), ["directory", "identity", "nonce"]);
    assert.deepEqual(saved.identity, identity);
    assert.match(saved.nonce, /^[a-f0-9]{32}$/);
    const directory = path.join(temp, `reader-native-source-${saved.nonce}`);
    assert.equal(saved.directory, directory);
    assert.equal(path.dirname(directory), temp);
    if (existsSync(directory)) {
      assert(!lstatSync(directory).isSymbolicLink());
      assert.equal(realpathSync(directory), directory);
      assert.equal(permissions(directory).currentUserOnly, true);
      const files = readdirSync(directory);
      assert(files.every((n) => allowedFiles.includes(n)));
      for (const name of files) regular(path.join(directory, name));
      const marker = path.join(directory, "scope.json");
      if (existsSync(marker)) {
        assert.equal(permissions(marker).currentUserOnly, true);
        assert.deepEqual(JSON.parse(readFileSync(marker)), saved);
      } else assert.equal(files.length, 0, "MISSING_OWNERSHIP_MARKER");
      // Delete credentials first and the ownership marker last, so an always()
      // retry can safely finish a partially completed cleanup.
      for (const name of allowedFiles) {
        const file = path.join(directory, name);
        if (existsSync(file)) rmSync(file);
      }
      rmdirSync(directory);
    }
    rmSync(stateFile);
    assert(!existsSync(directory) && !existsSync(stateFile));
  };
  if (operation === "cleanup") {
    clean();
    console.log("Owned native source credentials absent; no parent ACL was changed");
    return;
  }
  if (operation === "seal") {
    const members = [];
    for (const [name, file] of [
      ["private-build.log", log],
      ["source-controls.json", path.join(output, "source-controls.json")],
    ])
      if (existsSync(file)) {
        regular(file);
        assert(lstatSync(file).size <= 64 * 1024 * 1024);
        const bytes = readFileSync(file);
        members.push({ name, sha256: digest(bytes), base64: bytes.toString("base64") });
      }
    const body = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "reader-native-source-diagnostics",
        ...identity,
        members,
      }),
    );
    assert(body.length <= 96 * 1024 * 1024);
    writeFileSync(
      path.join(output, "source-diagnostics.enc.json"),
      JSON.stringify(
        encryptLog(
          gzipSync(body),
          readFileSync(new URL("./reader-native-tts-logs-public.pem", import.meta.url)),
        ),
      ),
      { mode: 0o600 },
    );
    console.log("Native source diagnostics encrypted; no qualification receipt issued");
    return;
  }
  assert.equal(permissions(output, outputFresh ? "directory" : "inspect").currentUserOnly, true);
  if (!existsSync(log)) privateFile(log);
  else assert.equal(permissions(log).currentUserOnly, true);
  logReady = true;
  const hooks = path.join(output, "empty-hooks");
  if (!existsSync(hooks)) {
    mkdirSync(hooks);
    assert.equal(permissions(hooks, "directory").currentUserOnly, true);
  } else assert.equal(permissions(hooks).currentUserOnly, true);
  assert.deepEqual(readdirSync(hooks), []);
  const crlf = readFileSync(
    new URL("./reader-native-tts-contract.mjs", import.meta.url),
    "utf8",
  ).includes("\r\n");
  const git = (args, options = {}) =>
    capture(
      "git",
      [
        "-c",
        `core.hooksPath=${hooks}`,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.longpaths=true",
        "-c",
        `core.autocrlf=${crlf}`,
        ...args,
      ],
      options,
    );
  // Match PATH's first application, exactly as checkout does, without joining matches.
  const ssh = capture(
    "pwsh.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Command ssh.exe -CommandType Application | Select-Object -First 1).Source",
    ],
    { record: false },
  ).stdout.trim();
  assert(path.isAbsolute(ssh));
  regular(ssh);
  const keygen = path.join(path.dirname(ssh), "ssh-keygen.exe");
  regular(keygen);
  const createScope = (key) => {
    assert(!existsSync(stateFile));
    const nonce = randomBytes(16).toString("hex"),
      directory = path.join(temp, `reader-native-source-${nonce}`);
    mkdirSync(directory);
    const saved = { identity, nonce, directory },
      marker = path.join(directory, "scope.json");
    let registered = false;
    try {
      assert.equal(permissions(directory, "directory").currentUserOnly, true);
      privateFile(marker);
      put(marker, JSON.stringify(saved));
      privateFile(stateFile);
      put(stateFile, JSON.stringify(saved));
      registered = true;
      const keyFile = path.join(directory, "key.pem"),
        hosts = path.join(directory, "known_hosts");
      privateFile(keyFile);
      privateFile(hosts);
      put(hosts, readFileSync(new URL("./reader-native-github-known-hosts", import.meta.url)));
      put(keyFile, `${key.trim().replaceAll("\r\n", "\n")}\n`);
      return { directory, keyFile, hosts };
    } catch (error) {
      if (registered) clean();
      else {
        // This call owns the freshly created nonce directory. Credentials are
        // never created before registration has completed.
        assert(!lstatSync(directory).isSymbolicLink());
        assert(readdirSync(directory).every((name) => name === "scope.json"));
        if (existsSync(marker)) {
          regular(marker);
          rmSync(marker);
        }
        rmdirSync(directory);
        if (existsSync(stateFile)) {
          regular(stateFile);
          rmSync(stateFile);
        }
      }
      throw error;
    }
  };
  const validateScope = (scope) => {
    assert.equal(permissions(scope.directory).currentUserOnly, true);
    for (const file of [scope.keyFile, scope.hosts]) {
      regular(file);
      assert.equal(permissions(file).currentUserOnly, true, "UNSAFE_CREDENTIAL_OBJECT");
    }
    assert.equal(
      digest(readFileSync(scope.hosts)),
      digest(readFileSync(new URL("./reader-native-github-known-hosts", import.meta.url))),
    );
  };
  const materialize = (key, target, { fault, observe = () => {} } = {}) => {
    assert(!existsSync(target));
    git(["init", "--quiet", `--template=${hooks}`, target]);
    let scope;
    try {
      scope = createScope(key);
      validateScope(scope);
      observe("prepared");
      if (fault === "after-key") throw new Error("INJECTED_AFTER_KEY");
      const env = {
        GIT_SSH_COMMAND: sshCommand(ssh, scope.keyFile, scope.hosts),
        GIT_SSH_VARIANT: "ssh",
      };
      git(
        [
          "-C",
          target,
          "fetch",
          "--quiet",
          "--no-tags",
          "--depth=2",
          "git@github.com:lwtlab/lwt-core.git",
          value.tested,
        ],
        { env },
      );
      assert.equal(git(["-C", target, "rev-parse", "FETCH_HEAD"]).stdout.trim(), value.tested);
      verifyCommit(git(["-C", target, "cat-file", "-p", value.tested]).stdout, value);
      observe("fetched");
      if (fault === "after-fetch") throw new Error("INJECTED_AFTER_FETCH");
    } finally {
      clean();
      observe("cleaned");
    }
    // No authentication file/environment remains when private files are materialized.
    assert(!existsSync(stateFile) && !existsSync(scope.directory));
    git(["-C", target, "checkout", "--quiet", "--detach", value.tested]);
    assert.equal(git(["-C", target, "rev-parse", "HEAD"]).stdout.trim(), value.tested);
    assert.equal(git(["-C", target, "status", "--porcelain"]).stdout.trim(), "");
    const config = git(
      [
        "-C",
        target,
        "config",
        "--local",
        "--get-regexp",
        "^(core\\.sshcommand|http\\..*extraheader|credential\\.|url\\..*insteadof)",
      ],
      { expectedFailure: true },
    );
    assert.equal(config.status, 1);
    assert.equal(config.stdout, "");
  };
  assert(secret && secret.length < 32768, "MISSING_READONLY_SOURCE_CREDENTIAL");
  if (operation === "checkout") {
    materialize(secret, path.join(root, "source"));
    console.log(
      "Exact private source and merge parents verified; credentials removed before checkout",
    );
    return;
  }
  const controls = {
      schemaVersion: 1,
      kind: "reader-native-source-controls",
      ...identity,
      status: "FAIL",
      stages: [],
    },
    save = () => writeFileSync(path.join(output, "source-controls.json"), JSON.stringify(controls));
  save();
  const sentinel = path.join(temp, `reader-native-sentinels-${randomBytes(16).toString("hex")}`);
  mkdirSync(sentinel);
  const inherited = path.join(sentinel, "inherited"),
    explicit = path.join(sentinel, "explicit"),
    nested = path.join(sentinel, "nested");
  writeFileSync(inherited, "synthetic");
  privateFile(explicit);
  put(explicit, "synthetic");
  permissions(explicit, "add-au");
  mkdirSync(nested);
  writeFileSync(path.join(nested, "child"), "synthetic");
  const objects = [temp, sentinel, inherited, explicit, nested, path.join(nested, "child")],
    before = objects.map((p) => permissions(p));
  const unchanged = () => {
    assert.deepEqual(
      objects.map((p) => permissions(p)),
      before,
      "SENTINEL_PERMISSIONS_CHANGED",
    );
    for (const p of [inherited, explicit, path.join(nested, "child")])
      assert.equal(readFileSync(p, "utf8"), "synthetic");
  };
  const synthetic = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  try {
    let scope = createScope(synthetic);
    unchanged();
    permissions(scope.keyFile, "add-au");
    assert.equal(permissions(scope.keyFile).currentUserOnly, false);
    assert.throws(() => validateScope(scope), /UNSAFE_CREDENTIAL_OBJECT/);
    const rejected = capture(keygen, ["-y", "-f", scope.keyFile], { expectedFailure: true });
    assert(rejected.status !== 0 && !rejected.error, "OPENSSH_NEGATIVE_CONTROL_NOT_RED");
    clean();
    unchanged();
    controls.stages.push("explicit-au-rejected");
    save();
    scope = createScope(synthetic);
    validateScope(scope);
    capture(keygen, ["-y", "-f", scope.keyFile]);
    clean();
    unchanged();
    controls.stages.push("production-object-openssh-pass");
    save();
    for (const fault of ["after-key", "after-fetch"]) {
      const target = path.join(sentinel, fault);
      assert.throws(
        () =>
          materialize(fault === "after-key" ? synthetic : secret, target, {
            fault,
            observe: unchanged,
          }),
        new RegExp(`INJECTED_${fault.replaceAll("-", "_").toUpperCase()}`),
      );
      assert(!existsSync(stateFile));
      assert.deepEqual(git(["-C", target, "ls-files"]).stdout.trim(), "");
      unchanged();
      controls.stages.push(`${fault}-cleanup-pass`);
      save();
    }
    const bad = path.join(sentinel, "untrusted-identity");
    assert.throws(
      () => materialize(synthetic, bad, { observe: unchanged }),
      /TRUSTED_CHILD_FAILED/,
    );
    assert(!existsSync(stateFile));
    unchanged();
    controls.stages.push("other-identity-cannot-fetch");
    save();
    controls.status = "PASS";
    save();
    console.log(
      "Native source controls PASS: bad ACL, exact identity, both injected failures and unchanged sentinels",
    );
  } finally {
    clean();
    unchanged();
    rmSync(sentinel, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    const code = /^[A-Z_]+$/.test(error.message ?? "") ? error.message : "SOURCE_BOUNDARY_ERROR";
    console.error(
      `Native source boundary failed (${code}); private details remain in encrypted diagnostics`,
    );
    process.exitCode = 1;
  });
