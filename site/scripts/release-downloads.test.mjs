import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { releaseDownloads } from '../src/lib/release-downloads.mjs';

const root = 'https://github.com/lwtlab/reader/releases';
function published() {
  const version = '0.26.0';
  return {
    schemaVersion: 1,
    desktop: { version, updatePolicy: 'manual', releaseUrl: `${root}/tag/desktop/v${version}`, checksumsUrl: `${root}/download/desktop/v${version}/SHA256SUMS`, assets: [
      ['darwin', 'arm64', 'mac-arm64-core.dmg'], ['darwin', 'x64', 'mac-x64-core.zip'],
      ['win32', 'x64', 'win-x64-core-setup.exe'], ['linux', 'x64', 'linux-x64-core.AppImage'],
    ].map(([platform, arch, tail]) => ({ platform, arch, profile: 'core', name: `Reader-${version}-${tail}`, url: `${root}/download/desktop/v${version}/Reader-${version}-${tail}`, sha256: 'a'.repeat(64), bytes: 123 })) },
    extension: { version: '0.26.0', desktopVersion: version, storeUrl: `https://chromewebstore.google.com/detail/reader-clipper/${'a'.repeat(32)}` },
  };
}

test('unpublished channels have no executable or store download links', () => {
  const unavailable = { desktop: null, extension: null, extensionUnpacked: null, assets: [] };
  assert.deepEqual(releaseDownloads({ schemaVersion: 1, desktop: null, extension: null }), unavailable);
  assert.deepEqual(releaseDownloads({ schemaVersion: 1, desktop: null, extension: null, extensionUnpacked: null }), unavailable);
});
test('reviewed metadata names all targets and separate Mac architectures', () => {
  assert.deepEqual(releaseDownloads(published()).assets.map(a => a.label), [
    'macOS Apple Silicon · DMG', 'macOS Intel · ZIP', 'Windows x64 · 安装版', 'Linux x64 · AppImage',
  ]);
});
test('manual and authenticated policies preserve the reviewed downloads and companion binding', () => {
  const manual = unpacked();
  const authenticated = structuredClone(manual);
  authenticated.desktop.updatePolicy = 'authenticated';
  const oldResult = releaseDownloads(manual), nextResult = releaseDownloads(authenticated);
  assert.equal(oldResult.desktop.updatePolicy, 'manual');
  assert.equal(nextResult.desktop.updatePolicy, 'authenticated');
  assert.deepEqual(nextResult.assets, oldResult.assets);
  assert.deepEqual(nextResult.extensionUnpacked, oldResult.extensionUnpacked);
});
test('both policies retain all eight published download identities and extension ZIP metadata', () => {
  const channels = JSON.parse(readFileSync(new URL('../../manifests/channels.json', import.meta.url), 'utf8'));
  for (const policy of ['manual', 'authenticated']) {
    const d = structuredClone(channels);
    d.desktop.updatePolicy = policy;
    const result = releaseDownloads(d);
    assert.equal(result.assets.length, 8);
    assert.deepEqual(result.assets.map(({ label, ...asset }) => asset), channels.desktop.assets);
    assert.deepEqual(result.extensionUnpacked, channels.extensionUnpacked);
  }
});
test('desktop update policy must be explicit and known', () => {
  for (const policy of [undefined, null, '', 'automatic', 'Authenticated', true, ['authenticated']]) {
    const d = published();
    if (policy === undefined) delete d.desktop.updatePolicy;
    else d.desktop.updatePolicy = policy;
    assert.throws(() => releaseDownloads(d), /Explicit supported desktop update policy required/);
  }
});
test('authenticated policy does not relax asset identity or the current desktop companion', () => {
  for (const change of [
    d => { d.desktop.assets[0].url = d.desktop.assets[0].url.replace('/lwtlab/reader/', '/another/reader/'); },
    d => { d.desktop.assets[0].arch = 'x64'; },
    d => { d.desktop.assets[0].profile = 'full'; },
    d => { d.desktop.assets[0].sha256 = 'invalid'; },
    d => { d.desktop.assets[0].bytes = 0; },
    d => { d.desktop.assets.push(d.desktop.assets[0]); },
    d => { d.extensionUnpacked.desktopVersion = '0.26.1'; },
  ]) {
    const d = unpacked();
    d.desktop.updatePolicy = 'authenticated';
    change(d);
    assert.throws(() => releaseDownloads(d));
  }
});
test('official URLs may encode a slash in the desktop release tag', () => {
  const d = published();
  d.desktop.releaseUrl = d.desktop.releaseUrl.replace('desktop/v', 'desktop%2Fv');
  d.desktop.checksumsUrl = d.desktop.checksumsUrl.replace('desktop/v', 'desktop%2Fv');
  d.desktop.assets = d.desktop.assets.map(a => ({...a, url:a.url.replace('desktop/v', 'desktop%2Fv')}));
  assert.equal(releaseDownloads(d).assets.length, 4);
});
test('wrong repository, target, digest, version or update policy blocks site build', () => {
  for (const change of [
    d => { d.desktop.assets[0].url = 'https://unreviewed.example/file.dmg'; },
    d => { d.desktop.assets[0].url = 'javascript:alert(1)'; },
    d => { d.desktop.assets[0].arch = 'unknown'; },
    d => { d.desktop.assets[0].name = '../Reader.dmg'; },
    d => { d.desktop.assets[0].sha256 = 'invalid'; },
    d => { d.desktop.assets[0].bytes = 0; },
    d => { d.desktop.version = '0.26.1'; },
    d => { d.desktop.updatePolicy = 'automatic'; },
    d => { d.desktop.releaseUrl = `${root}/latest`; },
    d => { d.desktop.assets.push(d.desktop.assets[0]); },
  ]) { const d = published(); change(d); assert.throws(() => releaseDownloads(d)); }
});
test('extension requires the declared published companion and official store', () => {
  for (const change of [
    d => { d.desktop = null; },
    d => { d.extension.desktopVersion = '0.25.0'; },
    d => { d.extension.storeUrl = 'https://example.com/reader.zip'; },
    d => { d.extension.storeUrl += '?tracking=1'; },
  ]) { const d = published(); change(d); assert.throws(() => releaseDownloads(d)); }
});

function unpacked() {
  const d = published();
  d.extension = null;
  d.extensionUnpacked = {
    version: '0.26.0', desktopVersion: '0.26.0',
    releaseUrl: `${root}/tag/extension/v0.26.0`,
    name: 'reader-clipper-v0.26.0.zip',
    url: `${root}/download/extension/v0.26.0/reader-clipper-v0.26.0.zip`,
    sha256: 'b'.repeat(64), bytes: 309272,
  };
  return d;
}

test('published unpacked extension is available independently of the absent store channel', () => {
  const d = unpacked(), result = releaseDownloads(d);
  assert.equal(result.extension, null);
  assert.deepEqual(result.extensionUnpacked, d.extensionUnpacked);
  assert.deepEqual(result.assets, releaseDownloads(published()).assets);
});

test('an extension revision can declare the existing desktop as its companion', () => {
  const d = unpacked();
  d.extensionUnpacked.version = '0.26.1';
  d.extensionUnpacked.name = 'reader-clipper-v0.26.1.zip';
  d.extensionUnpacked.releaseUrl = `${root}/tag/extension/v0.26.1`;
  d.extensionUnpacked.url = `${root}/download/extension/v0.26.1/reader-clipper-v0.26.1.zip`;
  assert.equal(releaseDownloads(d).extensionUnpacked.desktopVersion, '0.26.0');
});

test('store availability remains compatible with absent, null or independently published ZIP metadata', () => {
  const d = published();
  assert.deepEqual(releaseDownloads(d).extension, d.extension);
  assert.equal(releaseDownloads(d).extensionUnpacked, null);
  d.extensionUnpacked = null;
  assert.equal(releaseDownloads(d).extensionUnpacked, null);
  d.extensionUnpacked = unpacked().extensionUnpacked;
  assert.deepEqual(releaseDownloads(d).extension, d.extension);
  assert.deepEqual(releaseDownloads(d).extensionUnpacked, d.extensionUnpacked);
});

test('unpacked extension rejects incorrect source, filename, digest, size, version or companion', () => {
  for (const change of [
    d => { d.desktop = null; },
    d => { d.extensionUnpacked.version = '0.26.1'; },
    d => { d.extensionUnpacked.version = '0.26.0-beta.1'; },
    d => { d.extensionUnpacked.desktopVersion = '0.25.0'; },
    d => { d.extensionUnpacked.releaseUrl = `${root}/latest`; },
    d => { d.extensionUnpacked.releaseUrl = `${root}/tag/desktop/v0.26.0`; },
    d => { d.extensionUnpacked.name = 'reader-clipper-v0.26.1.zip'; },
    d => { d.extensionUnpacked.url = 'https://unreviewed.example/reader-clipper-v0.26.0.zip'; },
    d => { d.extensionUnpacked.url = d.extensionUnpacked.url.replace('/lwtlab/reader/', '/another/reader/'); },
    d => { d.extensionUnpacked.url += '?tracking=1'; },
    d => { d.extensionUnpacked.sha256 = 'invalid'; },
    d => { d.extensionUnpacked.bytes = 0; },
    d => { d.extensionUnpacked.bytes = 1.5; },
  ]) { const d = unpacked(); change(d); assert.throws(() => releaseDownloads(d)); }
});

test('official extension URLs may encode the release tag slash', () => {
  const d = unpacked();
  d.extensionUnpacked.releaseUrl = d.extensionUnpacked.releaseUrl.replace('extension/v', 'extension%2Fv');
  d.extensionUnpacked.url = d.extensionUnpacked.url.replace('extension/v', 'extension%2Fv');
  assert.deepEqual(releaseDownloads(d).extensionUnpacked, d.extensionUnpacked);
});
