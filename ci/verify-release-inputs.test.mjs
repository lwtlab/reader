import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyReleaseInputs } from './verify-release-inputs.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const script = fileURLToPath(new URL('./verify-release-inputs.mjs', import.meta.url));

function fixture(t) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'reader-frozen-preflight-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source');
  const notices = path.join(root, 'apps/reader/scripts/distribution-notices');
  mkdirSync(path.join(notices, 'blobs'), { recursive: true });
  const sourceName = 'apps/reader/package.json';
  const source = Buffer.from('{"name":"synthetic-reader","version":"0.26.1"}\n');
  writeFileSync(path.join(root, sourceName), source);
  const original = Buffer.from('Original authored copyright and permission notice.\r\n');
  const blobName = `blobs/${hash(original)}.txt`;
  writeFileSync(path.join(notices, blobName), original);
  const manifest = { formatVersion: 1, coverageStatus: 'incomplete', redistributionApproved: false, pendingNoticeReview: [{ status: 'authored-review-pending' }], sourceInputs: [{ path: sourceName, bytes: source.length, sha256: hash(source), hashKind: 'lf-normalized-text-sha256' }], blobs: [{ path: blobName, bytes: original.length, sha256: hash(original) }] };
  const save = () => writeFileSync(path.join(notices, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  save();
  return { temporary, root, notices, sourceName, source, original, blobName, manifest, save };
}

test('existing incomplete review does not block byte integrity or become redistribution approval', t => {
  const f = fixture(t);
  assert.deepEqual(verifyReleaseInputs(f.root), { status: 'PASS', sourceInputs: 1, sourceInputBytes: f.source.length, noticeBlobs: 1, noticeBlobBytes: f.original.length });
  const result = spawnSync(process.execPath, [script, f.root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), verifyReleaseInputs(f.root));
  assert.ok(!result.stdout.includes('redistributionApproved') && !result.stdout.includes('coverageStatus'));
});

test('a version-only package digest change fails in the preflight placed before all expensive native setup', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, f.sourceName), f.source.toString('utf8').replace('0.26.1', '0.26.2'));
  const result = spawnSync(process.execPath, [script, f.root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes('synthetic-reader') && !result.stderr.includes(f.root) && !result.stderr.includes(f.sourceName));
  const workflow = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8');
  const initialize = workflow.indexOf('- name: Initialize public Rust submodules');
  const check = workflow.indexOf('- name: Verify frozen source inputs and original notice bytes before native tools');
  const toolchain = workflow.indexOf('- uses: dtolnay/rust-toolchain@stable');
  const audit = workflow.indexOf('- name: Install fixed Rust dependency scanner');
  const dependencies = workflow.indexOf('- name: Install private application dependencies');
  assert.ok(initialize >= 0 && initialize < check && check < toolchain && check < audit && check < dependencies);
  assert.match(workflow, /node ci\/private-step\.mjs frozen-inputs source node \.\.\/ci\/verify-release-inputs\.mjs \./);
});

test('source CRLF equivalence preserves every non-UTF8 byte and rejects lone CR or changed bytes', t => {
  const f = fixture(t);
  const canonical = Buffer.from([0x61, 0xff, 0xfe, 0x0a]);
  f.manifest.sourceInputs[0].bytes = canonical.length;
  f.manifest.sourceInputs[0].sha256 = hash(canonical);
  f.save();
  writeFileSync(path.join(f.root, f.sourceName), Buffer.from([0x61, 0xff, 0xfe, 0x0d, 0x0a]));
  assert.equal(verifyReleaseInputs(f.root).status, 'PASS');
  for (const changed of [Buffer.from([0x61, 0xff, 0xfd, 0x0a]), Buffer.from([0x61, 0xff, 0xfe, 0x0d])]) {
    writeFileSync(path.join(f.root, f.sourceName), changed);
    assert.throws(() => verifyReleaseInputs(f.root), /digest differs/);
  }
});

test('notice blobs retain exact original CRLF bytes and cannot claim normalized hashes', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.notices, f.blobName), f.original.toString('latin1').replace(/\r\n/gu, '\n'), 'latin1');
  assert.throws(() => verifyReleaseInputs(f.root), /byte count differs/);
  writeFileSync(path.join(f.notices, f.blobName), f.original);
  f.manifest.blobs[0].hashKind = 'lf-normalized-text-sha256';
  f.save();
  assert.throws(() => verifyReleaseInputs(f.root), /raw file hashes/);
});

test('relative traversal, absolute paths, Windows paths and ambiguous separators fail', t => {
  for (const name of ['../outside.txt', '/outside.txt', 'C:/outside.txt', 'C:outside.txt', 'apps\\reader\\package.json', './apps/reader/package.json', 'apps//reader/package.json', 'apps/../package.json', 'apps/reader/file:stream', '', 'apps/reader/line\nname']) {
    const f = fixture(t); f.manifest.sourceInputs[0].path = name; f.save();
    assert.throws(() => verifyReleaseInputs(f.root), /Unsafe frozen input path/);
  }
});

test('external leaf and directory symlinks cannot escape the fixed source root', t => {
  for (const mode of ['leaf', 'directory']) {
    const f = fixture(t);
    const outside = path.join(f.temporary, 'outside'); mkdirSync(outside);
    writeFileSync(path.join(outside, 'package.json'), f.source);
    if (mode === 'leaf') {
      rmSync(path.join(f.root, f.sourceName));
      symlinkSync(path.join(outside, 'package.json'), path.join(f.root, f.sourceName));
    } else {
      symlinkSync(outside, path.join(f.root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
      f.manifest.sourceInputs[0].path = 'external/package.json';
      f.save();
    }
    assert.throws(() => verifyReleaseInputs(f.root));
  }
});

test('missing arrays, records, fields and referenced source/blob files fail closed', t => {
  for (const mutate of [
    f => { delete f.manifest.sourceInputs; },
    f => { f.manifest.sourceInputs = []; },
    f => { f.manifest.sourceInputs = [null]; },
    f => { delete f.manifest.sourceInputs[0].path; },
    f => { delete f.manifest.sourceInputs[0].bytes; },
    f => { delete f.manifest.sourceInputs[0].sha256; },
    f => { delete f.manifest.sourceInputs[0].hashKind; },
    f => { delete f.manifest.blobs; },
    f => { f.manifest.blobs = []; },
    f => { f.manifest.blobs = [null]; },
    f => { rmSync(path.join(f.root, f.sourceName)); },
    f => { rmSync(path.join(f.notices, f.blobName)); },
  ]) {
    const f = fixture(t); mutate(f); f.save(); assert.throws(() => verifyReleaseInputs(f.root));
  }
});

test('duplicate source or notice records cannot inflate checked counts', t => {
  for (const name of ['sourceInputs', 'blobs']) {
    const f = fixture(t); f.manifest[name].push(structuredClone(f.manifest[name][0])); f.save();
    assert.throws(() => verifyReleaseInputs(f.root), /Duplicate frozen input record/);
  }
});

test('unknown hash kinds and manifest schemas never silently fall back to raw or normalized hashing', t => {
  for (const mutate of [
    f => { f.manifest.sourceInputs[0].hashKind = 'file-sha256'; },
    f => { f.manifest.sourceInputs[0].hashKind = 'future-hash'; },
    f => { f.manifest.blobs[0].hashKind = 'future-hash'; },
    f => { delete f.manifest.formatVersion; },
    f => { f.manifest.formatVersion = 2; },
  ]) {
    const f = fixture(t); mutate(f); f.save(); assert.throws(() => verifyReleaseInputs(f.root));
  }
});

test('wrong byte counts, digests and digest-bound blob paths fail without file contents in CLI output', t => {
  for (const mutate of [
    f => { f.manifest.sourceInputs[0].bytes++; },
    f => { f.manifest.sourceInputs[0].bytes = 0; },
    f => { f.manifest.sourceInputs[0].sha256 = '0'.repeat(64); },
    f => { f.manifest.blobs[0].bytes++; },
    f => { f.manifest.blobs[0].sha256 = '0'.repeat(64); },
    f => { f.manifest.blobs[0].path = 'blobs/renamed.txt'; },
  ]) {
    const f = fixture(t); mutate(f); f.save();
    const result = spawnSync(process.execPath, [script, f.root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(f.original.toString('utf8').trim()) && !result.stderr.includes('synthetic-reader'));
  }
});

test('directories and empty files never satisfy regular nonempty frozen-input records', t => {
  for (const mode of ['directory', 'empty']) {
    const f = fixture(t); rmSync(path.join(f.root, f.sourceName));
    if (mode === 'directory') mkdirSync(path.join(f.root, f.sourceName));
    else writeFileSync(path.join(f.root, f.sourceName), '');
    assert.throws(() => verifyReleaseInputs(f.root), /bounded nonempty regular file/);
  }
});
