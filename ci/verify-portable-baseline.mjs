import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const baselines = JSON.parse(readFileSync(new URL('./portable-baselines.json', import.meta.url), 'utf8'));
export function verifyBaseline(target, run, artifact, jobs, approved = baselines) {
  const baseline = approved[target];
  assert.ok(baseline, 'Unsupported candidate target');
  assert.equal(run.id, baseline.run_id);
  assert.equal(run.status, 'completed');
  assert.equal(run.repository.full_name, 'lwtlab/reader');
  assert.equal(run.head_repository.full_name, 'lwtlab/reader');
  assert.equal(run.path, '.github/workflows/desktop-candidates.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.head_sha, baseline.workflow_ref);
  const job = jobs.find(job => job.name === target);
  assert.equal(job?.conclusion, 'success', 'Only a successful platform job is approved');
  assert.ok(job.steps.some(step => step.name === 'Upload verified candidate artifacts only' && step.conclusion === 'success'));
  assert.equal(artifact.id, baseline.artifact_id);
  assert.equal(artifact.name, baseline.artifact_name);
  assert.equal(artifact.workflow_run.id, baseline.run_id);
  assert.equal(artifact.workflow_run.head_sha, baseline.workflow_ref);
  assert.equal(artifact.digest, baseline.archive_digest);
  assert.equal(artifact.expired, false);
  return baseline;
}

export async function verifyCandidateOnline(target, approved = baselines) {
  const baseline = approved[target];
  assert.ok(baseline);
  assert.equal(process.env.GITHUB_REPOSITORY, 'lwtlab/reader');
  assert.ok(process.env.GITHUB_TOKEN);
  async function get(endpoint) {
    const response = await fetch(`https://api.github.com/repos/lwtlab/reader/${endpoint}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `Candidate API: ${response.status}`);
    return response.json();
  }
  const [run, artifact, jobs] = await Promise.all([
    get(`actions/runs/${baseline.run_id}`),
    get(`actions/artifacts/${baseline.artifact_id}`),
    get(`actions/runs/${baseline.run_id}/jobs?per_page=100`),
  ]);
  verifyBaseline(target, run, artifact, jobs.jobs, approved);
  console.log('Approved candidate identity, successful upload gate, archive digest and retention verified');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyCandidateOnline(process.env.PORTABLE_TARGET);
}
