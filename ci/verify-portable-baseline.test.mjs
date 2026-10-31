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
