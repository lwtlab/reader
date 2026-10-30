import assert from 'node:assert/strict';
import test from 'node:test';
import { baselines, verifyBaseline } from './verify-portable-baseline.mjs';

for (const target of Object.keys(baselines)) {
  test(`${target}: rejects foreign, failed, expired or changed artifacts`, () => {
    const baseline = baselines[target];
    const valid = {
      run: { id: baseline.run_id, status: 'completed', repository: { full_name: 'lwtlab/reader' }, head_repository: { full_name: 'lwtlab/reader' }, path: '.github/workflows/desktop-candidates.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: baseline.workflow_ref },
      artifact: { id: baseline.artifact_id, name: baseline.artifact_name, workflow_run: { id: baseline.run_id, head_sha: baseline.workflow_ref }, digest: baseline.archive_digest, expired: false },
      jobs: [{ name: target, conclusion: 'success', steps: [{ name: 'Upload verified candidate artifacts only', conclusion: 'success' }] }],
    };
    const invoke = item => verifyBaseline(target, item.run, item.artifact, item.jobs);
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
