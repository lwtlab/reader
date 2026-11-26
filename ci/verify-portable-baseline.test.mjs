import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { baselines, verifyBaseline } from './verify-portable-baseline.mjs';

const upgradeBaselines = JSON.parse(readFileSync(new URL('./upgrade-baselines.json', import.meta.url), 'utf8'));
const offlineBaselines = JSON.parse(readFileSync(new URL('./offline-baselines.json', import.meta.url), 'utf8'));
const coreBaselines = JSON.parse(readFileSync(new URL('./core-baselines.json', import.meta.url), 'utf8'));
const macosSigningBaselines = JSON.parse(readFileSync(new URL('./macos-signing-baselines.json', import.meta.url), 'utf8'));
const profileStorageBaselines = JSON.parse(readFileSync(new URL('./profile-storage-baselines.json', import.meta.url), 'utf8'));
for (const [kind, approved] of [['portable', baselines], ['upgrade', upgradeBaselines], ['core', coreBaselines], ['offline', offlineBaselines], ['profile-storage', profileStorageBaselines], ['macos-signing', macosSigningBaselines]])
for (const target of Object.keys(approved)) {
  test(`${kind} ${target}: rejects foreign, failed, expired or changed artifacts`, () => {
    const baseline = approved[target];
    const valid = {
      run: { id: baseline.run_id, status: 'completed', repository: { full_name: 'lwtlab/reader' }, head_repository: { full_name: 'lwtlab/reader' }, path: '.github/workflows/desktop-candidates.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: baseline.workflow_ref },
      artifact: { id: baseline.artifact_id, name: baseline.artifact_name, workflow_run: { id: baseline.run_id, head_sha: baseline.workflow_ref }, digest: baseline.archive_digest, expired: false },
      jobs: [{ name: target, conclusion: 'success', steps: [{ name: 'Upload verified candidate artifacts only', conclusion: 'success' }] }],
    };
    const invoke = item => verifyBaseline(target, item.run, item.artifact, item.jobs, approved);
    assert.equal(invoke(valid), baseline);
    for (const mutate of [
      item => { item.run.head_repository.full_name = 'foreign/fork'; },
      item => { item.run.path = '.github/workflows/other.yml'; },
      item => { item.run.head_sha = '0'.repeat(40); },
      item => { item.jobs[0].conclusion = 'failure'; },
      item => { item.jobs[0].steps[0].conclusion = 'skipped'; },
      item => { item.artifact.id++; },
      item => { item.artifact.workflow_run.id++; },
      item => { item.artifact.expired = true; },
      item => { item.artifact.digest = 'sha256:' + '0'.repeat(64); },
    ]) {
      const changed = structuredClone(valid); mutate(changed); assert.throws(() => invoke(changed));
    }
  });
}

function currentProducerFixture() {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8');
  const names = [...workflow.matchAll(/^      - name: (.+)$/gm)].map(match => match[1]);
  const uploads = names.filter(name => /^Upload .*candidate artifacts only$/.test(name));
  assert.equal(uploads.length, 1, 'Producer must have one final candidate upload gate');
  const auditName = 'Audit final candidate files before upload';
  assert.ok(names.indexOf(auditName) < names.indexOf(uploads[0]) && names.includes(auditName));
  const target = 'darwin-arm64';
  const baseline = { run_id: 101, artifact_id: 202, artifact_name: 'reader-darwin-arm64-candidate', archive_digest: 'sha256:' + '1'.repeat(64), source_ref: '2'.repeat(40), workflow_ref: '3'.repeat(40) };
  const fixture = {
    run: { id: baseline.run_id, status: 'completed', repository: { full_name: 'lwtlab/reader' }, head_repository: { full_name: 'lwtlab/reader' }, path: '.github/workflows/desktop-candidates.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: baseline.workflow_ref },
    artifact: { id: baseline.artifact_id, name: baseline.artifact_name, workflow_run: { id: baseline.run_id, head_sha: baseline.workflow_ref }, digest: baseline.archive_digest, expired: false },
    jobs: [{ name: target, conclusion: 'success', steps: [{ name: auditName, conclusion: 'success', number: 1 }, { name: uploads[0], conclusion: 'success', number: 2 }] }],
  };
  return { fixture, invoke: value => verifyBaseline(target, value.run, value.artifact, value.jobs, { [target]: baseline }) };
}

test('current production upload is accepted only after the actual final audit succeeds', () => {
  const { fixture, invoke } = currentProducerFixture();
  assert.ok(invoke(fixture));
  for (const mutate of [
    value => { value.jobs[0].steps[0].conclusion = 'failure'; },
    value => { value.jobs[0].steps[0].conclusion = 'skipped'; },
    value => { value.jobs[0].steps[0].name = 'Other audit'; },
    value => { delete value.jobs[0].steps[0].number; },
    value => { value.jobs[0].steps[1].conclusion = 'failure'; },
    value => { value.jobs[0].steps[1].conclusion = 'skipped'; },
    value => { delete value.jobs[0].steps[1].number; },
    value => { value.jobs[0].steps[0].number = 3; },
    value => { value.jobs[0].steps[1].conclusion = 'failure'; value.jobs[0].steps.push({ name: 'Upload verified candidate artifacts only', conclusion: 'success', number: 3 }); },
    value => { value.run.head_branch = 'review-branch'; },
    value => { value.artifact.expired = true; },
  ]) {
    const changed = structuredClone(fixture); mutate(changed); assert.throws(() => invoke(changed));
  }
});
