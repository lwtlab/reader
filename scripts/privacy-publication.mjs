import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireReleasePrivacy } from './release-privacy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function auditPublication(manifest, assets, attachments, audit = requireReleasePrivacy) {
  const options = { projectDir: process.env.READER_PRIVACY_TOOLS || path.resolve(root, '../../apps/reader'), profile: manifest.product === 'desktop' ? 'desktop' : 'generic' };
  for (const file of assets) {
    const report = await audit(file, options);
    const expected = manifest.assets.find(a => a.name === path.basename(file));
    assert.equal(report.status, 'PASS', 'Privacy audit did not pass');
    assert.equal(report.hashKind, 'file-sha256', 'Final publication requires file hashes');
    assert.equal(report.artifactSha256, expected?.sha256, 'Audited bytes differ from publication manifest');
  }
  for (const file of attachments) {
    const report = await audit(file, { ...options, plainFile: true });
    assert.equal(report.status, 'PASS', 'Public attachment privacy audit did not pass');
  }
}
