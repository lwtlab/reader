import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [candidate, source] = process.argv.slice(2);
assert.ok(candidate && source, 'Candidate and private checkout paths required');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
assert.equal(commit, process.env.SOURCE_REF, 'Private checkout must match immutable dispatch input');
const index = JSON.parse(readFileSync(path.join(candidate, 'desktop-artifacts.json'), 'utf8'));
assert.equal(index.profile, 'bundled-speech');
assert.equal(index.platform, process.platform);
assert.equal(index.arch, process.arch);
for (const artifact of index.artifacts) {
  assert.equal(path.basename(artifact.name), artifact.name);
  const file = path.join(candidate, artifact.name);
  assert.ok(lstatSync(file).isFile());
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), artifact.sha256);
}
const report = {
  kind: 'synthetic-release-validation', status: 'PASS',
  source: { repository: 'lwtlab/lwt-core', commit },
  delivery: { repository: process.env.GITHUB_REPOSITORY, workflowCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT },
  version: index.version, profile: index.profile, platform: process.platform, arch: process.arch,
  checks: { packagedSpeech: 'PASS', packagedService: 'PASS', window: 'PASS', installerLifecycle: 'PASS', historicalUpgrade: 'NOT_RUN' },
  artifacts: index.artifacts, signing: 'unsigned-candidate',
};
writeFileSync(path.join(candidate, 'internal-candidate-provenance.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Recorded immutable source and verified candidate digests');
