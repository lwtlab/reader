import assert from 'node:assert/strict';
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
  assert.deepEqual(releaseDownloads({ schemaVersion: 1, desktop: null, extension: null }), { desktop: null, extension: null, assets: [] });
});
test('reviewed metadata names all targets and separate Mac architectures', () => {
  assert.deepEqual(releaseDownloads(published()).assets.map(a => a.label), [
    'macOS Apple Silicon · DMG', 'macOS Intel · ZIP', 'Windows x64 · 安装版', 'Linux x64 · AppImage',
  ]);
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
