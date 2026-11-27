import assert from 'node:assert/strict';
import test from 'node:test';
import { selectUpdateCandidates, verifyUpdateCandidate } from './verify-update-candidate.mjs';

function fixture(target) {
  const mac = target.startsWith('darwin-');
  const baseline = {
    os: { 'darwin-arm64': 'macos-15', 'darwin-x64': 'macos-15-intel', 'win32-x64': 'windows-latest', 'linux-x64': 'ubuntu-22.04' }[target],
    run_id: 101, artifact_id: 202, artifact_name: `reader-${target}-${mac ? 'signed-' : ''}candidate`,
    archive_digest: `sha256:${'1'.repeat(64)}`, source_ref: '2'.repeat(40), workflow_ref: '3'.repeat(40),
    version: '0.26.1', profile: 'core', update_policy: mac ? 'signed-stable-v1' : 'project-authenticated-v1',
  };
  const value = {
    run: { id: baseline.run_id, status: 'completed', repository: { full_name: 'lwtlab/reader' }, head_repository: { full_name: 'lwtlab/reader' }, path: `.github/workflows/${mac ? 'macos-signed-candidates' : 'desktop-candidates'}.yml`, event: 'workflow_dispatch', head_branch: 'main', head_sha: baseline.workflow_ref },
    artifact: { id: baseline.artifact_id, name: baseline.artifact_name, workflow_run: { id: baseline.run_id, head_sha: baseline.workflow_ref }, digest: baseline.archive_digest, expired: false },
    jobs: [{ name: `${mac ? 'signed-' : ''}${target}`, conclusion: 'success', steps: mac ? [
      { name: 'Verify real signatures tickets containers and Gatekeeper', conclusion: 'success', number: 1 },
      { name: 'Audit final signed files before upload', conclusion: 'success', number: 2 },
      { name: 'Upload privacy-checked signed candidates only', conclusion: 'success', number: 3 },
    ] : [
      { name: 'Audit final candidate files before upload', conclusion: 'success', number: 1 },
      { name: 'Upload privacy-checked candidate artifacts only', conclusion: 'success', number: 2 },
    ] }],
  };
  const approved = { [target]: baseline };
  return { value, baseline, approved, invoke: input => verifyUpdateCandidate(target, input.run, input.artifact, input.jobs, approved) };
}

for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
  test(`${target}: update authentication requires the exact successful final native payload`, () => {
    const { value, baseline, invoke } = fixture(target);
    assert.equal(invoke(value), baseline);
    for (const mutate of [
      item => { item.run.head_repository.full_name = 'foreign/fork'; },
      item => { item.run.path = '.github/workflows/other.yml'; },
      item => { item.run.head_branch = 'unreviewed'; },
      item => { item.run.head_sha = '0'.repeat(40); },
      item => { item.run.event = 'pull_request'; },
      item => { item.jobs[0].conclusion = 'failure'; },
      item => { item.jobs[0].steps[0].conclusion = 'skipped'; },
      item => { item.jobs[0].steps[0].number = 10; },
      item => { delete item.jobs[0].steps[0].number; },
      item => { item.artifact.id++; },
      item => { item.artifact.workflow_run.id++; },
      item => { item.artifact.workflow_run.head_sha = '4'.repeat(40); },
      item => { item.artifact.digest = `sha256:${'0'.repeat(64)}`; },
      item => { item.artifact.expired = true; },
    ]) {
      const changed = structuredClone(value);
      mutate(changed);
      assert.throws(() => invoke(changed));
    }
  });
}

test('an empty approval set never defaults to old manual-update candidates', () => {
  assert.throws(() => selectUpdateCandidates('all', '2'.repeat(40), {}), /No approved final update candidates/);
  const { approved, baseline } = fixture('linux-x64');
  const selected = selectUpdateCandidates('all', baseline.source_ref, approved);
  assert.equal(selected[0].platform, 'linux');
  assert.equal(selected[0].arch, 'x64');
  assert.throws(() => selectUpdateCandidates('all', '5'.repeat(40), approved), /must match/);
  assert.throws(() => selectUpdateCandidates('all', 'main', approved), /Immutable/);
  assert.throws(() => selectUpdateCandidates('all', baseline.source_ref, { 'linux-x64': { ...baseline, update_policy: 'disabled' } }));
  assert.throws(() => selectUpdateCandidates('all', baseline.source_ref, { 'linux-x64': { ...baseline, os: 'self-hosted' } }));
  assert.throws(() => selectUpdateCandidates('all', baseline.source_ref, { 'linux-x64': { ...baseline, version: '0.26.2-beta' } }));
});
