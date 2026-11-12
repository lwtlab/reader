import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditPublication } from './privacy-publication.mjs';
import { scanReleasePrivacy } from './release-privacy.mjs';
import { syntheticHermes } from './release/hermes-strings.test.mjs';

test('public Hermes scanner retains unreviewed cross-string values and whole credentials', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-hermes-'));
  try {
    const file = path.join(directory, 'index.android.bundle'), value = 'ABCDefgh1234ijkl5678mnop9012qrst';
    writeFileSync(file, syntheticHermes(["apiKey='", value.slice(0, 17), value.slice(17), "';"]));
    const clean = await scanReleasePrivacy(directory);
    assert.equal(clean.status, 'FAIL');
    assert(!clean.notices.some(n => n.rule === 'hermes-cross-string-match'));
    writeFileSync(file, syntheticHermes(["apiKey='", value, "';"]));
    assert.equal((await scanReleasePrivacy(directory)).status, 'FAIL');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('publication requires passing checks of the exact staged bytes and scans notes too', async () => {
  const manifest = { assets: [{ name: 'candidate.zip', sha256: 'a'.repeat(64) }] };
  const checked = [];
  const audit = async (file, options) => {
    checked.push([file, options.plainFile]);
    return { status: 'PASS', hashKind: 'file-sha256', artifactSha256: 'a'.repeat(64) };
  };
  await auditPublication(manifest, ['/private/staged/candidate.zip'], ['/private/staged/notes.md'], audit);
  assert.deepEqual(checked.map(x => path.basename(x[0])), ['candidate.zip', 'notes.md']);
  assert.equal(checked[1][1], true);
  await assert.rejects(auditPublication(manifest, ['candidate.zip'], [], async () => ({ status: 'FAIL' })));
  await assert.rejects(auditPublication(manifest, ['candidate.zip'], [], async () => ({ status: 'PASS', hashKind: 'file-sha256', artifactSha256: 'b'.repeat(64) })));
});

test('compiler route names and PEM parsing literals pass; actual private key material does not', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-pem-'));
  try {
    const route = path.join(directory, '.next/server/app/api/uploads/route.js');
    mkdirSync(path.dirname(route), { recursive: true });
    writeFileSync(route, 'export function GET() {}');
    const file = path.join(directory, 'crypto-parser.js');
    writeFileSync(file, 'const header="-----BEGIN PRIVATE KEY-----", footer="-----END PRIVATE KEY-----";');
    assert.equal((await scanReleasePrivacy(directory)).status, 'PASS');
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(file, JSON.stringify({ privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) }));
    assert.equal((await scanReleasePrivacy(directory)).status, 'FAIL');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('desktop-only inactive Next action metadata never exempts account keys or active actions', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-next-'));
  try {
    const file = path.join(directory, '.next/server/server-reference-manifest.json');
    mkdirSync(path.dirname(file), { recursive: true });
    const metadata = { node: {}, edge: {}, encryptionKey: randomBytes(32).toString('base64') };
    writeFileSync(file, JSON.stringify(metadata));
    assert.equal((await scanReleasePrivacy(directory)).status, 'FAIL');
    assert.equal((await scanReleasePrivacy(directory, { profile: 'desktop' })).status, 'PASS');
    writeFileSync(file, JSON.stringify({ ...metadata, node: { action: {} } }));
    assert.equal((await scanReleasePrivacy(directory, { profile: 'desktop' })).status, 'FAIL');
    writeFileSync(file, JSON.stringify({ ...metadata, accountApiKey: ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('') }));
    assert.equal((await scanReleasePrivacy(directory, { profile: 'desktop' })).status, 'FAIL');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('standalone public scanner detects synthetic secrets in ZIP members, without private checkout', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-'));
  try {
    const clean = path.join(directory, 'clean.zip');
    execFileSync('python3', ['-c', "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('app.js','const value = 42;')", clean]);
    assert.equal((await scanReleasePrivacy(clean)).status, 'PASS');
    const notes = path.join(directory, 'notes.md');
    const token = ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
    writeFileSync(notes, token);
    const report = await scanReleasePrivacy(notes, { plainFile: true });
    assert.equal(report.status, 'FAIL');
    assert(!JSON.stringify(report).includes(token));
    const alias = path.join(directory, 'case-sensitive.apk');
    execFileSync('python3', ['-c', "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('res/Config.xml','clean');z.writestr('res/config.xml',sys.argv[2])", alias, token]);
    const aliasReport = await scanReleasePrivacy(alias);
    assert.equal(aliasReport.status, 'FAIL');
    assert.equal(aliasReport.filesScanned, 3, 'Both case-sensitive members must be inspected on macOS too');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
