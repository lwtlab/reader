import assert from 'node:assert/strict';

export const desktopPlatforms = [
  { id: 'darwin', title: 'macOS', anchor: 'macos', pending: 'Apple Silicon 与 Intel · DMG / ZIP' },
  { id: 'win32', title: 'Windows', anchor: 'windows', pending: 'x64 · 安装版 / Portable' },
  { id: 'linux', title: 'Linux', anchor: 'linux', pending: 'x64 · DEB / AppImage' },
];
const stableVersion = /^\d+\.\d+\.\d+$/;
function publishedUrl(actual, suffix) {
  const url = new URL(actual);
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.equal(decodeURIComponent(url.pathname), `/lwtlab/reader/releases/${suffix}`);
}

// Availability comes only from reviewed publication metadata, never OS detection or Latest.
export function releaseDownloads(channels) {
  assert.equal(channels.schemaVersion, 1);
  const desktop = channels.desktop;
  const assets = [];
  if (desktop !== null) {
    assert.ok(desktop && stableVersion.test(desktop.version), 'Published desktop version required');
    assert.equal(desktop.updatePolicy, 'manual', 'Initial desktop channel requires manual updates');
    const tag = `desktop/v${desktop.version}`;
    publishedUrl(desktop.releaseUrl, `tag/${tag}`);
    publishedUrl(desktop.checksumsUrl, `download/${tag}/SHA256SUMS`);
    assert.ok(Array.isArray(desktop.assets) && desktop.assets.length > 0, 'Published assets required');
    const names = new Set();
    for (const asset of desktop.assets) {
      assert.equal(asset.profile, 'core');
      const platform = desktopPlatforms.find((p) => p.id === asset.platform);
      assert.ok(platform, 'Unknown desktop platform');
      assert.ok(asset.arch === 'x64' || (asset.platform === 'darwin' && asset.arch === 'arm64'));
      const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[asset.platform];
      const prefix = `Reader-${desktop.version}-${os}-${asset.arch}-core`;
      const formats = asset.platform === 'darwin'
        ? [['.dmg', 'DMG'], ['.zip', 'ZIP']]
        : asset.platform === 'win32'
          ? [['-setup.exe', '安装版'], ['-portable.exe', 'Portable']]
          : [['.deb', 'DEB'], ['.AppImage', 'AppImage']];
      const format = formats.find(([suffix]) => asset.name === prefix + suffix);
      assert.ok(format, 'Asset filename differs from declared version/target');
      assert.ok(!names.has(asset.name), 'Duplicate download');
      names.add(asset.name);
      publishedUrl(asset.url, `download/${tag}/${asset.name}`);
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
      const architecture = asset.platform === 'darwin' ? (asset.arch === 'arm64' ? 'Apple Silicon' : 'Intel') : 'x64';
      assets.push({ ...asset, label: `${platform.title} ${architecture} · ${format[1]}` });
    }
  }
  const extension = channels.extension;
  if (extension !== null) {
    assert.ok(extension && stableVersion.test(extension.version));
    assert.ok(desktop && extension.desktopVersion === desktop.version, 'Published companion desktop required');
    const url = new URL(extension.storeUrl);
    assert.equal(url.origin, 'https://chromewebstore.google.com');
    assert.equal(url.username + url.password + url.search + url.hash, '');
    assert.match(url.pathname, /^\/detail\/[^/]+\/[a-p]{32}$/);
  }
  const extensionUnpacked = channels.extensionUnpacked ?? null;
  if (extensionUnpacked !== null) {
    assert.ok(extensionUnpacked && stableVersion.test(extensionUnpacked.version), 'Published extension ZIP version required');
    assert.ok(desktop && extensionUnpacked.desktopVersion === desktop.version, 'Published companion desktop required');
    const tag = `extension/v${extensionUnpacked.version}`;
    assert.equal(extensionUnpacked.name, `reader-clipper-v${extensionUnpacked.version}.zip`);
    publishedUrl(extensionUnpacked.releaseUrl, `tag/${tag}`);
    publishedUrl(extensionUnpacked.url, `download/${tag}/${extensionUnpacked.name}`);
    assert.match(extensionUnpacked.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(extensionUnpacked.bytes) && extensionUnpacked.bytes > 0);
  }
  return { desktop, extension, extensionUnpacked, assets };
}
