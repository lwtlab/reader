import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBaseline } from './verify-portable-baseline.mjs';

export const updateBaselines = JSON.parse(readFileSync(new URL('./update-signing-baselines.json', import.meta.url), 'utf8'));

export function selectUpdateCandidates(requested, sourceRef, approved = updateBaselines) {
  assert.match(sourceRef ?? '', /^[a-f0-9]{40}$/, 'Immutable signing source required');
  assert.ok(['all', 'darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].includes(requested));
  const selected = Object.entries(approved).filter(([id]) => requested === 'all' || id === requested);
  assert.ok(selected.length, 'No approved final update candidates; freeze native outputs before authentication');
  return selected.map(([id, item]) => {
    assert.equal(item.source_ref, sourceRef, 'Authentication source must match the approved candidate');
    assert.match(item.workflow_ref ?? '', /^[a-f0-9]{40}$/);
    assert.match(item.archive_digest ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.match(item.version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.equal(item.profile, 'core');
    const [platform, arch] = id.split('-');
    assert.ok(['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].includes(id));
    assert.equal(item.os, { 'darwin-arm64': 'macos-15', 'darwin-x64': 'macos-15-intel', 'win32-x64': 'windows-latest', 'linux-x64': 'ubuntu-22.04' }[id]);
    assert.equal(item.update_policy, platform === 'darwin' ? 'signed-stable-v1' : 'project-authenticated-v1');
    assert.ok(Number.isSafeInteger(item.run_id) && item.run_id > 0);
    assert.ok(Number.isSafeInteger(item.artifact_id) && item.artifact_id > 0);
    assert.equal(item.artifact_name, `reader-${id}-${platform === 'darwin' ? 'signed-' : ''}candidate`);
    return { ...item, id, platform, arch };
  });
}

export function verifyUpdateCandidate(target, run, artifact, jobs, approved = updateBaselines) {
  const baseline = approved[target];
  assert.ok(baseline, 'Missing approved update candidate');
  selectUpdateCandidates(target, baseline.source_ref, approved);
  if (!target.startsWith('darwin-')) {
    verifyBaseline(target, run, artifact, jobs, approved);
    const job = jobs.find(item => item.name === target);
    const audit = job.steps.find(step => step.name === 'Audit final candidate files before upload');
    const upload = job.steps.find(step => step.name === 'Upload privacy-checked candidate artifacts only');
    assert.equal(audit?.conclusion, 'success');
    assert.equal(upload?.conclusion, 'success');
    assert.ok(Number.isInteger(audit.number) && audit.number > 0);
    assert.ok(Number.isInteger(upload.number) && upload.number > audit.number);
    return baseline;
  }
  assert.equal(run.id, baseline.run_id);
  assert.equal(run.status, 'completed');
  assert.equal(run.repository.full_name, 'lwtlab/reader');
  assert.equal(run.head_repository.full_name, 'lwtlab/reader');
  assert.equal(run.path, '.github/workflows/macos-signed-candidates.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.head_sha, baseline.workflow_ref);
  const job = jobs.find(item => item.name === `signed-${target}`);
  assert.equal(job?.conclusion, 'success', 'Final native signing and QA job must succeed');
  const audit = job.steps.find(step => step.name === 'Audit final signed files before upload');
  const upload = job.steps.find(step => step.name === 'Upload privacy-checked signed candidates only');
  const verification = job.steps.find(step => step.name === 'Verify real signatures tickets containers and Gatekeeper');
  assert.equal(verification?.conclusion, 'success');
  assert.equal(audit?.conclusion, 'success');
  assert.equal(upload?.conclusion, 'success');
  assert.ok(Number.isInteger(verification.number) && verification.number > 0);
  assert.ok(Number.isInteger(audit.number) && audit.number > verification.number);
  assert.ok(Number.isInteger(upload.number) && upload.number > audit.number);
  assert.equal(artifact.id, baseline.artifact_id);
  assert.equal(artifact.name, baseline.artifact_name);
  assert.equal(artifact.workflow_run.id, baseline.run_id);
  assert.equal(artifact.workflow_run.head_sha, baseline.workflow_ref);
  assert.equal(artifact.digest, baseline.archive_digest);
  assert.equal(artifact.expired, false);
  return baseline;
}

async function main() {
  const target = process.env.UPDATE_TARGET;
  if (process.env.UPDATE_SELECT === 'true') {
    const matrix = selectUpdateCandidates(target, process.env.SOURCE_REF);
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
    return;
  }
  assert.equal(process.env.GITHUB_REPOSITORY, 'lwtlab/reader');
  assert.ok(process.env.GITHUB_TOKEN);
  const baseline = updateBaselines[target];
  assert.ok(baseline);
  async function get(endpoint) {
    const response = await fetch(`https://api.github.com/repos/lwtlab/reader/${endpoint}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `Update candidate API: ${response.status}`);
    return response.json();
  }
  const [run, artifact, jobs] = await Promise.all([
    get(`actions/runs/${baseline.run_id}`), get(`actions/artifacts/${baseline.artifact_id}`),
    get(`actions/runs/${baseline.run_id}/jobs?per_page=100`),
  ]);
  verifyUpdateCandidate(target, run, artifact, jobs.jobs);
  console.log('Approved final update candidate provenance, native gates, archive digest and retention verified');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
