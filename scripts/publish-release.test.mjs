import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { releaseIdentity, releaseManifest, releaseCommands, publishRelease } from './publish-release.mjs';

test('product tags preserve legacy Android and isolate desktop/extension latest', () => {
  assert.deepEqual(['mobile', 'desktop', 'extension'].map(product => {
    const { tag, latest } = releaseIdentity(product, '1.2.3');
    return [tag, latest];
  }), [['v1.2.3', true], ['desktop/v1.2.3', false], ['extension/v1.2.3', false]]);
  for (const version of ['v1.2.3', '1.2', '1.2.3-beta', '01.2.3', '../main']) {
    assert.throws(() => releaseIdentity('mobile', version));
  }
  assert.throws(() => releaseIdentity('unknown', '1.2.3'));
});

test('failed draft upload never publishes; plan-only never calls GitHub', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'reader-publish-cli-'));
  try {
    const asset = path.join(directory, 'reader-clipper-v1.2.3.zip');
    const notes = path.join(directory, 'notes.md');
    writeFileSync(asset, 'original synthetic artifact'); writeFileSync(notes, 'Original release notes');
    const args = ['--product', 'extension', '--version', '1.2.3', '--source-sha', 'a'.repeat(40), '--notes', notes, '--asset', asset];
    const calls = [], output = [];
    const run = (command, argv) => {
      if (command === 'git') return argv[0] === 'rev-parse' ? 'b'.repeat(40) : '';
      assert.equal(command, 'gh');
      calls.push(argv);
      if (argv[0] === 'api') return 'b'.repeat(40);
      throw new Error('synthetic draft creation failure');
    };
    await publishRelease(args, { run, log: value => output.push(value) });
    assert.equal(JSON.parse(output[0]).mode, 'plan-only');
    assert.equal(calls.length, 0);
    // Exercise the real CLI path with the actual platform URL conversion too.
    const plan = spawnSync(process.execPath, [fileURLToPath(new URL('./publish-release.mjs', import.meta.url)), ...args], { encoding: 'utf8' });
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).mode, 'plan-only');
    await assert.rejects(publishRelease([...args, '--publish'], { run }), /synthetic draft creation failure/);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].slice(0, 2), ['release', 'create']);
    assert.ok(calls[1].includes('--draft'));
    assert.ok(!calls.some(call => call[1] === 'edit'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('release metadata binds actual bytes to distinct public and private commits', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'reader-publish-test-'));
  try {
    const asset = path.join(directory, 'reader-clipper-v1.2.3.zip');
    writeFileSync(asset, 'original synthetic archive');
    const input = { product: 'extension', version: '1.2.3', sourceSha: 'a'.repeat(40), publicSha: 'b'.repeat(40), assets: [asset] };
    const manifest = await releaseManifest(input);
    assert.equal(manifest.source.commit, input.sourceSha);
    assert.equal(manifest.delivery.commit, input.publicSha);
    assert.equal(manifest.assets[0].sha256, createHash('sha256').update('original synthetic archive').digest('hex'));
    const commands = releaseCommands(manifest, 'notes.md', [asset], 'reader-release.json');
    assert.equal(commands.length, 2);
    assert.ok(commands[0].includes('--draft'));
    assert.equal(commands[0][commands[0].indexOf('--target') + 1], input.publicSha);
    assert.ok(commands[1].includes('--draft=false'));
    assert.ok(commands[1].includes('--latest=false'));
    assert.ok(commands.every(command => command[command.indexOf('--repo') + 1] === 'lwtlab/reader'));
    await assert.rejects(releaseManifest({ ...input, sourceSha: 'main' }));
    await assert.rejects(releaseManifest({ ...input, assets: [asset, asset] }));
    await assert.rejects(releaseManifest({ ...input, product: 'mobile' }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
