import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('private output and spawn failures stay out of the public console', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'reader-log-contract-'));
  try {
    mkdirSync(path.join(temp, 'source'));
    const invoke = (command, args = []) => spawnSync(process.execPath,
      [fileURLToPath(new URL('./private-step.mjs', import.meta.url)), 'probe', 'source', command, ...args],
      { cwd: temp, env: { ...process.env, RUNNER_TEMP: temp }, encoding: 'utf8' });
    for (const exit of [0, 7]) {
      const result = invoke(process.execPath, ['-e', `console.log('SYNTHETIC-PRIVATE-OUT');console.error('SYNTHETIC-PRIVATE-ERR');process.exit(${exit})`]);
      assert.equal(result.status, exit === 0 ? 0 : 1);
      assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC-PRIVATE/);
    }
    const missing = invoke('reader-no-such-command');
    assert.equal(missing.status, 1);
    assert.doesNotMatch(missing.stdout + missing.stderr, /ENOENT|Spawn error|reader-no-such-command/);
    const log = readFileSync(path.join(temp, 'reader-private-build.log'), 'utf8');
    assert.match(log, /SYNTHETIC-PRIVATE-OUT/);
    assert.match(log, /SYNTHETIC-PRIVATE-ERR/);
    assert.match(log, /Spawn error:/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('reviewed tooling checkout keeps output private and artifact/traversal directories cannot execute', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'reader-tooling-log-contract-'));
  try {
    mkdirSync(path.join(temp, 'tooling'));
    const invoke = directory => spawnSync(process.execPath,
      [fileURLToPath(new URL('./private-step.mjs', import.meta.url)), 'engine-cache-restore', directory, process.execPath, '-e', "console.log('SYNTHETIC-PRIVATE-TOOLING')"],
      { cwd: temp, env: { ...process.env, RUNNER_TEMP: temp }, encoding: 'utf8' });
    const accepted = invoke('tooling');
    assert.equal(accepted.status, 0);
    assert.doesNotMatch(accepted.stdout + accepted.stderr, /SYNTHETIC-PRIVATE-TOOLING/);
    const before = readFileSync(path.join(temp, 'reader-private-build.log'), 'utf8');
    assert.match(before, /SYNTHETIC-PRIVATE-TOOLING/);
    for (const directory of ['engine-cache', 'engine-cache-new', 'tooling/../source', 'source/../tooling', '/tmp']) {
      const rejected = invoke(directory);
      assert.notEqual(rejected.status, 0);
      assert.doesNotMatch(rejected.stdout + rejected.stderr, /SYNTHETIC-PRIVATE-TOOLING/);
    }
    assert.equal(readFileSync(path.join(temp, 'reader-private-build.log'), 'utf8'), before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
