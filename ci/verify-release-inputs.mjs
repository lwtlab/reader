import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestPath = 'apps/reader/scripts/distribution-notices/manifest.json';
const maxFileBytes = 8 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function safeRelative(name) {
  assert.ok(typeof name === 'string' && name.length > 0 && !path.isAbsolute(name) && !path.win32.isAbsolute(name) && !/[\\:\x00-\x1f\x7f]/u.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe frozen input path');
}

function inside(root, file) {
  const relative = path.relative(root, file);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Frozen input must stay within its declared root');
}

function regular(root, name) {
  safeRelative(name);
  const file = path.resolve(root, name);
  inside(root, file);
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= maxFileBytes, 'Frozen input must be a bounded nonempty regular file');
  const canonical = realpathSync(file);
  inside(root, canonical);
  return { bytes: readFileSync(file), canonical };
}

function verifyRecords(root, records, normalized) {
  assert.ok(Array.isArray(records) && records.length > 0, 'Frozen input records must be a nonempty array');
  const names = new Set(), canonicalFiles = new Set();
  let checkedBytes = 0;
  for (const record of records) {
    assert.ok(record && typeof record === 'object' && !Array.isArray(record), 'Missing frozen input record');
    safeRelative(record.path);
    assert.ok(!names.has(record.path), 'Duplicate frozen input record');
    names.add(record.path);
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes > 0 && record.bytes <= maxFileBytes, 'Invalid frozen input byte count');
    assert.match(record.sha256 ?? '', /^[a-f0-9]{64}$/u, 'Invalid frozen input digest');
    if (normalized) assert.equal(record.hashKind, 'lf-normalized-text-sha256', 'Unknown source input hash kind');
    else {
      assert.ok(record.hashKind === undefined || record.hashKind === 'file-sha256', 'Notice blobs require raw file hashes');
      assert.equal(record.path, `blobs/${record.sha256}.txt`, 'Notice blob path must bind its raw digest');
    }
    const input = regular(root, record.path);
    assert.ok(!canonicalFiles.has(input.canonical), 'Duplicate physical frozen input');
    canonicalFiles.add(input.canonical);
    // Normalize only CRLF representations of source manifests. Latin-1 preserves
    // all other bytes, including invalid UTF-8 and lone CR. Notice text is raw.
    const bytes = normalized ? Buffer.from(input.bytes.toString('latin1').replace(/\r\n/gu, '\n'), 'latin1') : input.bytes;
    assert.equal(bytes.length, record.bytes, 'Frozen input byte count differs');
    assert.equal(hash(bytes), record.sha256, 'Frozen input digest differs');
    checkedBytes += bytes.length;
  }
  return { files: records.length, bytes: checkedBytes };
}

/** Byte integrity only. Closure coverage and redistribution decisions remain separate. */
export function verifyReleaseInputs(inputRoot) {
  const root = realpathSync(path.resolve(inputRoot));
  assert.ok(lstatSync(root).isDirectory(), 'Source root must be a directory');
  const frozen = regular(root, manifestPath);
  const manifest = JSON.parse(frozen.bytes.toString('utf8'));
  assert.equal(manifest.formatVersion, 1, 'Unknown frozen input manifest schema');
  const sourceInputs = verifyRecords(root, manifest.sourceInputs, true);
  const noticesRoot = realpathSync(path.dirname(path.join(root, manifestPath)));
  inside(root, noticesRoot);
  const blobs = verifyRecords(noticesRoot, manifest.blobs, false);
  return { status: 'PASS', sourceInputs: sourceInputs.files, sourceInputBytes: sourceInputs.bytes, noticeBlobs: blobs.files, noticeBlobBytes: blobs.bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'Use verify-release-inputs.mjs <source-root>');
    console.log(JSON.stringify(verifyReleaseInputs(process.argv[2])));
  } catch {
    // Never echo source paths, contents, hashes or child command diagnostics.
    console.error('Frozen release input preflight failed; no integrity pass issued.');
    process.exitCode = 1;
  }
}
