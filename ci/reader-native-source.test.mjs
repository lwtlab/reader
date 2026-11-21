import assert from "node:assert/strict";
import test from "node:test";
import { childEnvironment, sshCommand, verifyCommit } from "./reader-native-source.mjs";

test("source children receive a closed system environment without credentials, Git redirects or agents", () => {
  const env = childEnvironment({
    Path: "tools",
    HOME: "home",
    SystemRoot: "windows",
    READER_NATIVE_SOURCE_SSH_KEY: "synth",
    reader_native_source_ssh_key: "synth",
    GH_TOKEN: "synth",
    GITHUB_TOKEN: "synth",
    ACTIONS_RUNTIME_TOKEN: "synth",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.sshCommand",
    GIT_CONFIG_VALUE_0: "evil",
    SSH_AUTH_SOCK: "agent",
    NODE_OPTIONS: "--require evil",
  });
  assert.equal(env.Path, "tools");
  assert.equal(env.HOME, "home");
  assert.equal(env.SystemRoot, "windows");
  assert.equal(env.GIT_CONFIG_GLOBAL, "NUL");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  for (const key of [
    "READER_NATIVE_SOURCE_SSH_KEY",
    "reader_native_source_ssh_key",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "ACTIONS_RUNTIME_TOKEN",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "SSH_AUTH_SOCK",
    "NODE_OPTIONS",
  ])
    assert(!Object.hasOwn(env, key));
});
test("SSH uses one explicit identity, pinned hosts and no interactive or agent fallback", () => {
  const cmd = sshCommand(
    "C:\\Program Files\\OpenSSH\\ssh.exe",
    "D:\\owned\\key.pem",
    "D:\\owned\\known_hosts",
  );
  for (const fixed of [
    "IdentityAgent=none",
    "IdentitiesOnly=yes",
    "BatchMode=yes",
    "StrictHostKeyChecking=yes",
    "UpdateHostKeys=no",
    "PasswordAuthentication=no",
    "ForwardAgent=no",
  ])
    assert(cmd.includes(fixed));
  assert(cmd.includes("'C:/Program Files/OpenSSH/ssh.exe'"));
  for (const p of ["bad'path", "bad\npath"]) assert.throws(() => sshCommand(p, "key", "hosts"));
});
test("raw commit headers must match both immutable merge parents, never the message", () => {
  const value = {
    head: "a".repeat(40),
    base: "b".repeat(40),
    tested: "c".repeat(40),
    workflow: "d".repeat(40),
    pr: 331,
  };
  const bytes = `tree ${"e".repeat(40)}\nparent ${value.base}\nparent ${value.head}\nauthor synthetic\n\nmessage\nparent ${"f".repeat(40)}\n`;
  verifyCommit(bytes, value);
  assert.throws(() => verifyCommit(bytes.replace(value.base, "f".repeat(40)), value));
  assert.throws(() => verifyCommit(bytes.replace("\n\n", "\n"), value));
});
