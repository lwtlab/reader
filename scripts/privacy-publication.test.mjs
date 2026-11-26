import './release/asar.test.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditPublication } from './privacy-publication.mjs';
import { scanReleasePrivacy } from './release-privacy.mjs';
import { syntheticHermes } from './release/hermes-strings.test.mjs';

test('final candidate audit fails closed with bounded redacted artifact diagnostics', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-diagnostic-'));
  try {
    writeFileSync(path.join(directory, 'metadata.json'), '{"authored":"synthetic"}');
    const run = () => spawnSync(process.execPath, ['ci/privacy-candidates.mjs', directory], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    const token = ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
    execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n in range(40):z.writestr("authored-%s.json"%n,sys.argv[2])', path.join(directory, 'leak.zip'), JSON.stringify({ token })]);
    const result = run();
    assert.notEqual(result.status, 0);
    const line = result.stderr.split(/\r?\n/).find(line => line.startsWith('{"kind":"candidate-privacy-block"'));
    const diagnostic = JSON.parse(line);
    assert.equal(diagnostic.artifact, 'leak.zip');
    assert.match(diagnostic.artifactSha256, /^[a-f0-9]{64}$/);
    assert.ok(diagnostic.findingCount >= 40);
    assert.equal(diagnostic.findings.length, 32);
    assert.equal(diagnostic.truncated, true);
    assert(!JSON.stringify(diagnostic).includes(directory));
    assert(!result.stderr.includes(token));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('real 7z literal backslash paths remain unsafe on each host', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-7z-alias-'));
  try {
    const archive = path.join(directory, 'aliases.7z');
    // Authored two-member fixture, not user content or a captured payload.
    writeFileSync(archive, Buffer.from('N3q8ryccAATIRd4snQAAAAAAAAAhAAAAAAAAAHiVj4NBdXRob3JlZCBzeW50aGV0aWMgZmlyc3QgbWVtYmVyLgpBdXRob3JlZCBzeW50aGV0aWMgYWxpYXMgbWVtYmVyLgoAAIEzB64xmmkDYhBp8gjD1qTaxaUgWU7rj+niGwsxfcBqTLzfDEn0TxxPyyI8P4VMF4p9Jx9MjQlaWjLXkZetZpYqCWHV+kWnHCJXFR4chPfRmiPBnZYlVisAFwZCAQlbAAcLAQABIwMBAQVdABAAAAyAjgoBSvsXMQAA', 'base64'));
    await assert.rejects(scanReleasePrivacy(archive), /Unsafe installer\/archive entry/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

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

test('publication audits supported desktop metadata assets through the real privacy gate', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'publication-leaf-assets-'));
  try {
    const entries = [
      ['SHA256SUMS', `${'a'.repeat(64)}  Reader-0.26.0-linux-x64-core.AppImage\n`],
      ['acceptance-decision.json', JSON.stringify({ source: 'authored-synthetic', manualAcceptance: { performed: false, passed: false } })],
      ['delivery-policy.json', JSON.stringify({ automaticUpdates: 'disabled', publicationAuthorized: true })],
    ];
    const assets = entries.map(([name, bytes]) => {
      const file = path.join(directory, name);
      writeFileSync(file, bytes);
      return file;
    });
    const manifest = { product: 'desktop', assets: entries.map(([name, bytes]) => ({ name, sha256: createHash('sha256').update(bytes).digest('hex') })) };
    await auditPublication(manifest, assets, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('publication blocks synthetic credentials in every supported desktop metadata asset', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'publication-leaf-secrets-'));
  try {
    const token = ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
    for (const name of ['SHA256SUMS', 'acceptance-decision.json', 'delivery-policy.json']) {
      const file = path.join(directory, name);
      const bytes = name === 'SHA256SUMS' ? `${token}\n` : JSON.stringify({ authoredSyntheticToken: token });
      writeFileSync(file, bytes);
      const manifest = { product: 'desktop', assets: [{ name, sha256: createHash('sha256').update(bytes).digest('hex') }] };
      await assert.rejects(auditPublication(manifest, [file], []), /Release privacy gate blocked/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('publication keeps unknown top-level asset formats blocked', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'publication-unknown-asset-'));
  try {
    const name = 'notice.unknown', bytes = '{"authored":"synthetic"}';
    const file = path.join(directory, name);
    writeFileSync(file, bytes);
    const manifest = { product: 'desktop', assets: [{ name, sha256: createHash('sha256').update(bytes).digest('hex') }] };
    await assert.rejects(auditPublication(manifest, [file], []), /Unsupported artifact/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('publication rejects a clean metadata asset whose bytes differ from its manifest', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'publication-leaf-digest-'));
  try {
    const name = 'delivery-policy.json', file = path.join(directory, name);
    writeFileSync(file, JSON.stringify({ authored: 'synthetic', automaticUpdates: 'disabled' }));
    const manifest = { product: 'desktop', assets: [{ name, sha256: '0'.repeat(64) }] };
    await assert.rejects(auditPublication(manifest, [file], []), /Audited bytes differ from publication manifest/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('publication still inspects compressed archive members when leaf assets are enabled', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'publication-archive-members-'));
  try {
    const name = 'authored.zip', file = path.join(directory, name);
    const archive = (bytes) => execFileSync('python3', ['-c',
      "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('nested/authored.txt',sys.argv[2])", file, bytes]);
    const manifest = () => ({ product: 'desktop', assets: [{ name, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }] });
    archive('Authored synthetic public text.');
    await auditPublication(manifest(), [file], []);
    archive(['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join(''));
    await assert.rejects(auditPublication(manifest(), [file], []), /Release privacy gate blocked/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
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

test('desktop-only inactive Next metadata retains key-shape, account-key and active-route boundaries', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-next-'));
  try {
    const file = path.join(directory, '.next/server/server-reference-manifest.json');
    mkdirSync(path.dirname(file), { recursive: true });
    const keys=[11,251,255].map(first=>Buffer.from([first,...Array.from({length:31},(_,n)=>(n*37+48)%256)]).toString('base64'));
    keys.push(Buffer.alloc(32).toString('base64'));
    for(const encryptionKey of keys){
      const metadata = { node: {}, edge: {}, encryptionKey };
      writeFileSync(file, JSON.stringify(metadata));
      assert.equal((await scanReleasePrivacy(directory)).status, 'FAIL');
      assert.equal((await scanReleasePrivacy(directory, { profile: 'desktop' })).status, 'PASS');
      writeFileSync(file, JSON.stringify({ ...metadata, node: { action: {} } }));
      assert.equal((await scanReleasePrivacy(directory, { profile: 'desktop' })).status, 'FAIL');
      writeFileSync(file, JSON.stringify({ ...metadata, accountApiKey: ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('') }));
      assert.equal((await scanReleasePrivacy(directory, { profile: 'desktop' })).status, 'FAIL');
    }
    rmSync(file);
    const preview={version:4,routes:{},dynamicRoutes:{},preview:{previewModeSigningKey:'0'.repeat(64),previewModeEncryptionKey:'f'.repeat(64)}};
    const prerender=path.join(directory,'.next/prerender-manifest.json');
    writeFileSync(prerender,JSON.stringify(preview));
    assert.equal((await scanReleasePrivacy(directory)).status,'FAIL');
    assert.equal((await scanReleasePrivacy(directory,{profile:'desktop'})).status,'PASS');
    writeFileSync(prerender,JSON.stringify({...preview,routes:{'/':{}}}));
    assert.equal((await scanReleasePrivacy(directory,{profile:'desktop'})).status,'FAIL');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('literal POSIX backslashes do not classify a filename as inactive compiler metadata', { skip: process.platform === 'win32' }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-separators-'));
  try {
    writeFileSync(path.join(directory, '.next\\server\\server-reference-manifest.json'), JSON.stringify({ node: {}, edge: {}, encryptionKey: Buffer.alloc(32).toString('base64') }));
    const report = await scanReleasePrivacy(directory, { profile: 'desktop' });
    assert.equal(report.status, 'FAIL');
    assert(!report.notices.some(n => n.rule === 'unused-next-desktop-action-key'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Next preview sidecar requires matching manifests and keeps generic/active cases blocked', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-preview-'));
  try {
    const preview = { previewModeId:'1'.repeat(32), previewModeSigningKey:'0'.repeat(64), previewModeEncryptionKey:'f'.repeat(64) };
    const copy = path.join(directory,'.next/server/preview-props.json');
    const prerender = path.join(directory,'.next/prerender-manifest.json');
    const actions = path.join(directory,'.next/server/server-reference-manifest.json');
    mkdirSync(path.dirname(copy),{recursive:true});
    writeFileSync(copy,JSON.stringify(preview));
    assert.equal((await scanReleasePrivacy(directory,{profile:'desktop'})).status,'FAIL');
    const manifest={version:4,routes:{},dynamicRoutes:{},preview};
    const reference={node:{},edge:{},encryptionKey:Buffer.alloc(32).toString('base64')};
    writeFileSync(prerender,JSON.stringify(manifest));
    writeFileSync(actions,JSON.stringify(reference));
    assert.equal((await scanReleasePrivacy(directory)).status,'FAIL');
    assert.equal((await scanReleasePrivacy(directory,{profile:'desktop'})).status,'PASS');
    for(const value of [{...preview,previewModeSigningKey:'2'.repeat(64)},{...preview,unknown:true},{...preview,accountApiKey:['ghp_','abcdefghijklmnopqrstuvwxyz0123456789'].join('')}]){
      writeFileSync(copy,JSON.stringify(value));
      assert.equal((await scanReleasePrivacy(directory,{profile:'desktop'})).status,'FAIL');
    }
    writeFileSync(copy,JSON.stringify(preview));
    writeFileSync(actions,JSON.stringify({...reference,node:{action:{}}}));
    assert.equal((await scanReleasePrivacy(directory,{profile:'desktop'})).status,'FAIL');
    writeFileSync(actions,JSON.stringify(reference));
    writeFileSync(prerender,JSON.stringify({...manifest,dynamicRoutes:{'/[slug]':{}}}));
    assert.equal((await scanReleasePrivacy(directory,{profile:'desktop'})).status,'FAIL');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('nameless XZ tar streams are inspected and unsafe tar members still block', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'public-privacy-xz-'));
  try {
    const archive=path.join(directory,'data.tar.xz');
    const create=(name,content)=>execFileSync('python3',['-c',
      "import io,lzma,pathlib,sys,tarfile\nb=io.BytesIO();d=sys.argv[3].encode()\nwith tarfile.open(fileobj=b,mode='w') as t:\n i=tarfile.TarInfo(sys.argv[2]);i.size=len(d);t.addfile(i,io.BytesIO(d))\npathlib.Path(sys.argv[1]).write_bytes(lzma.compress(b.getvalue()))",archive,name,content]);
    create('app.js','const count = 42;');
    assert.equal((await scanReleasePrivacy(archive)).status,'PASS');
    create('app.js',['ghp_','abcdefghijklmnopqrstuvwxyz0123456789'].join(''));
    assert.equal((await scanReleasePrivacy(archive)).status,'FAIL');
    create('../outside','const count = 42;');
    await assert.rejects(scanReleasePrivacy(archive),/Unsafe/);
    create('clean.js','x');
    execFileSync('python3',['-c',"import lzma,pathlib,sys;p=pathlib.Path(sys.argv[1]);b=lzma.decompress(p.read_bytes());p.write_bytes(lzma.compress(b[:1024]+b'x'*512+b'\\0'*1024))",archive]);
    await assert.rejects(scanReleasePrivacy(archive),/TAR/,'bad header after a valid member cannot pass');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Next home route filenames in checksum metadata do not exempt real homes or credentials', async () => {
  const directory=mkdtempSync(path.join(tmpdir(),'public-privacy-route-'));
  try {
    const file=path.join(directory,'md5sums'),prefix='opt/Reader/resources/standalone/apps/reader/.next/server/app/api';
    writeFileSync(file,`${"1".repeat(32)}  ${prefix}/home/route/build-manifest.json\n`);
    assert.equal((await scanReleasePrivacy(directory)).status,'PASS');
    for(const extra of ['/home/route/private.txt',`${prefix}/home/route/private.txt`,['ghp_','abcdefghijklmnopqrstuvwxyz0123456789'].join('')]){
      writeFileSync(file,`${"1".repeat(32)}  ${prefix}/home/route/build-manifest.json\n${extra}`);
      assert.equal((await scanReleasePrivacy(directory)).status,'FAIL');
    }
    for(const line of [`1234  ${prefix}/home/route/build-manifest.json`,`${"1".repeat(32)}  /${prefix}/home/route/build-manifest.json`,`${"1".repeat(32)}  extra/${prefix}/home/route/build-manifest.json`]){
      writeFileSync(file,`${line}\n`);
      assert.equal((await scanReleasePrivacy(directory)).status,'FAIL');
    }
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

// Authored metadata only; these fixtures never contain product source or user evidence.
const macMetadataSecret = ["ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
function macMetadataFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "public-mac-metadata-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const payload = path.join(root, "payload");
  mkdirSync(payload);
  return { root, payload, write(name, value) {
    const file = path.join(payload, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
    return file;
  }};
}
test("Mac resource indices classify only typed compiler keys, never values or unknown paths", async (t) => {
  const f = macMetadataFixture(t);
  const relative = "Reader.app/Contents/_CodeSignature/CodeResources";
  const file = f.write(relative, "");
  const generate = (mode) =>
    execFileSync("python3", [
      "-c",
      `
import pathlib,plistlib,sys
prefix='Resources/standalone/apps/reader/.next/server/app/api/home/route/'
key=prefix+'build-manifest.json'
d={'files':{key:b'a'*20},'files2':{key:{'hash2':b'b'*32}},'rules':{},'rules2':{}}
mode=sys.argv[2]
if mode=='unknown':d['files'][prefix+'private.txt']=b'c'*20
if mode=='value':d['rules']['note']='/home/route/build-manifest.json'
if mode=='forged-key':d['rules'][key]={}
if mode=='wrong-hash':d['files2'][key]['hash2']=b'x'
if mode=='real-home':d['files']['/home/synthetic-user/private.txt']=b'a'*20
if mode=='credential':d['rules']['note']=sys.argv[3]
if mode=='schema':d['unknown']={}
pathlib.Path(sys.argv[1]).write_bytes(plistlib.dumps(d))
`,
      file,
      mode,
      macMetadataSecret,
    ]);
  generate("clean");
  const clean = await scanReleasePrivacy(f.payload);
  assert.equal(clean.status, "PASS");
  assert.ok(clean.notices.some((n) => n.rule === "next-api-route-metadata-path"));
  for (const mode of [
    "unknown",
    "value",
    "forged-key",
    "wrong-hash",
    "real-home",
    "credential",
    "schema",
  ]) {
    generate(mode);
    assert.equal((await scanReleasePrivacy(f.payload)).status, "FAIL", mode);
  }
});

test("Mac ZIP compiler names are proven in both headers without exempting stored prose", async (t) => {
  const f = macMetadataFixture(t);
  const archive = path.join(f.root, "candidate.zip");
  const generate = (mode) =>
    execFileSync("python3", [
      "-c",
      `
import sys,zipfile
name='Reader.app/Contents/Resources/standalone/apps/reader/.next/server/app/api/home/route/build-manifest.json'
mode=sys.argv[2]
if mode=='unknown':name=name.replace('build-manifest.json','private.txt')
if mode=='wrong-prefix':name='unreviewed/'+name
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z:
 z.writestr(name.rsplit('/',1)[0]+'/',b'')
 z.writestr(name,'{}')
 if mode=='prose':z.writestr('notes.txt',name)
 if mode=='credential':z.writestr('app.js',sys.argv[3])
 if mode=='real-home':z.writestr('notes.txt','/home/synthetic-user/private.txt')
`,
      archive,
      mode,
      macMetadataSecret,
    ]);
  generate("clean");
  assert.equal((await scanReleasePrivacy(archive)).status, "PASS");
  for (const mode of ["unknown", "wrong-prefix", "prose", "credential", "real-home"]) {
    generate(mode);
    assert.equal((await scanReleasePrivacy(archive)).status, "FAIL", mode);
  }
});
