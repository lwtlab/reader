import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const [directory, source] = process.argv.slice(2);
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding: 'utf8'}).trim();
assert.equal(sourceSha, process.env.SOURCE_REF);
assert.equal(sourceSha, '4d4a44876e9833bae0c9d1120b588623f5a46ea8');
const index = JSON.parse(readFileSync(path.join(directory, 'desktop-artifacts.json'), 'utf8'));
assert.equal(index.version, '0.1.13'); assert.equal(index.profile, 'core');
assert.equal(index.platform, process.platform); assert.equal(index.arch, process.arch);
for (const row of index.artifacts) {
  assert.equal(path.basename(row.name), row.name);
  const bytes = readFileSync(path.join(directory, row.name));
  assert.equal(bytes.length, row.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
}
writeFileSync(path.join(directory, 'historical-baseline-provenance.json'), JSON.stringify({
  kind: 'synthetic-historical-upgrade-baseline', sourceSha, version: index.version, profile: index.profile,
  platform: process.platform, arch: process.arch, artifacts: index.artifacts,
  checks: { cleanHistoricalSourceBuild: 'PASS', packagedService: 'PASS', artifactDigestVerification: 'PASS', currentReleaseAcceptance: 'NOT_RUN' },
  delivery: {repository: process.env.GITHUB_REPOSITORY, workflowCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID},
  boundary: 'Fresh rebuild of historical source solely for old-to-new upgrade; not a historical public release binary',
}, null, 2) + '\n');
console.log('Recorded native historical baseline source and exact artifact identities');
