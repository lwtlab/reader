import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { releaseIdentity, releaseManifest, releaseCommands } from './publish-release.mjs';

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

test('failed draft upload never publishes; plan-only never calls GitHub', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'reader-publish-cli-'));
  try {
    const log = path.join(directory, 'gh-calls.jsonl');
    const git = path.join(directory, 'git');
    const gh = path.join(directory, 'gh');
    writeFileSync(git, '#!/usr/bin/env node\nif(process.argv[2]===\'rev-parse\') console.log(\'b\'.repeat(40));\n');
    writeFileSync(gh, '#!/usr/bin/env node\nconst fs=require("node:fs"); const args=process.argv.slice(2); fs.appendFileSync(process.env.READER_TEST_GH_LOG,JSON.stringify(args)+"\\n"); if(args[0]==="api")console.log("b".repeat(40)); else process.exit(1);\n');
    chmodSync(git, 0o755); chmodSync(gh, 0o755);
    const asset = path.join(directory, 'reader-clipper-v1.2.3.zip');
    const notes = path.join(directory, 'notes.md');
    writeFileSync(asset, 'original synthetic artifact'); writeFileSync(notes, 'Original release notes');
    const args = [new URL('./publish-release.mjs', import.meta.url).pathname, '--product', 'extension', '--version', '1.2.3', '--source-sha', 'a'.repeat(40), '--notes', notes, '--asset', asset];
    const env = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, READER_TEST_GH_LOG: log };
    const plan = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).mode, 'plan-only');
    const failed = spawnSync(process.execPath, [...args, '--publish'], { env, encoding: 'utf8' });
    assert.notEqual(failed.status, 0);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.length, 2); // API reachability, then failed draft creation.
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
