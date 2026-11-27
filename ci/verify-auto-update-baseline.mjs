import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const autoUpdateBaselines = JSON.parse(readFileSync(new URL('./auto-update-baselines.json', import.meta.url), 'utf8'));
const hosts = { 'darwin-arm64': 'macos-15', 'darwin-x64': 'macos-15-intel', 'win32-x64': 'windows-latest', 'linux-x64': 'ubuntu-22.04' };
const sha = /^[a-f0-9]{40}$/;
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function candidateTuple(target, candidate) {
  assert.ok(candidate && typeof candidate === 'object');
  assert.equal(candidate.os, hosts[target]);
  assert.match(candidate.source_ref ?? '', sha);
  assert.match(candidate.workflow_ref ?? '', sha);
  assert.match(candidate.archive_digest ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.match(candidate.version ?? '', stable);
  assert.equal(candidate.profile, 'core');
  assert.equal(candidate.update_policy, target.startsWith('darwin-') ? 'signed-stable-v1' : 'project-authenticated-v1');
  assert.ok(Number.isSafeInteger(candidate.run_id) && candidate.run_id > 0);
  assert.ok(Number.isSafeInteger(candidate.artifact_id) && candidate.artifact_id > 0);
  assert.equal(candidate.artifact_name, `reader-${target}-authenticated-candidate`);
}

export function selectAutoUpdatePairs(requested, qaSourceRef, approved = autoUpdateBaselines) {
  assert.match(qaSourceRef ?? '', sha, 'Immutable QA source required');
  assert.ok(requested === 'all' || Object.hasOwn(hosts, requested));
  const selected = Object.entries(approved).filter(([id]) => requested === 'all' || id === requested);
  assert.ok(selected.length, 'No approved authenticated upgrade pairs; freeze both real versions before QA');
  return selected.map(([id, pair]) => {
    assert.ok(Object.hasOwn(hosts, id));
    assert.equal(pair.qa_source_ref, qaSourceRef, 'QA source must match the reviewed runner, independently of either application source');
    candidateTuple(id, pair.from);
    candidateTuple(id, pair.to);
    assert.notEqual(pair.from.artifact_id, pair.to.artifact_id, 'Two distinct immutable artifacts required');
    assert.notEqual(pair.from.source_ref, pair.to.source_ref, 'Versions must come from distinct compiled sources');
    const before = pair.from.version.split('.').map(BigInt), after = pair.to.version.split('.').map(BigInt);
    const different = before.findIndex((value, index) => value !== after[index]);
    assert.ok(different >= 0 && after[different] > before[different], 'Actual upgrade must increase version');
    const [platform, arch] = id.split('-');
    return { id, os: hosts[id], platform, arch, qa_source_ref: pair.qa_source_ref, from: pair.from, to: pair.to };
  });
}

export function verifyAuthenticatedUpgradeCandidate(target, candidate, run, artifact, jobs) {
  assert.ok(Object.hasOwn(hosts, target));
  candidateTuple(target, candidate);
  assert.equal(run.id, candidate.run_id);
  assert.equal(run.status, 'completed');
  assert.equal(run.repository.full_name, 'lwtlab/reader');
  assert.equal(run.head_repository.full_name, 'lwtlab/reader');
  assert.equal(run.path, '.github/workflows/authenticate-desktop-updates.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.head_sha, candidate.workflow_ref);
  const job = jobs.find(item => item.name === `authenticate-${target}`);
  assert.equal(job?.conclusion, 'success', 'Authenticated candidate job must succeed');
  const gates = [
    'Verify final candidate before accessing the update key',
    'Authenticate exact final update bytes',
    'Audit authenticated payloads and channel before upload',
    'Upload authenticated candidates without publishing an update feed',
  ];
  let previous = 0;
  for (const name of gates) {
    const step = job.steps.find(item => item.name === name);
    assert.equal(step?.conclusion, 'success', 'Every final provenance, authentication, privacy and upload gate must succeed');
    assert.ok(Number.isInteger(step.number) && step.number > previous, 'Authentication gates must complete in producer order');
    previous = step.number;
  }
  assert.equal(artifact.id, candidate.artifact_id);
  assert.equal(artifact.name, candidate.artifact_name);
  assert.equal(artifact.workflow_run.id, candidate.run_id);
  assert.equal(artifact.workflow_run.head_sha, candidate.workflow_ref);
  assert.equal(artifact.digest, candidate.archive_digest);
  assert.equal(artifact.expired, false);
  return candidate;
}

export async function verifyAutoUpdatePairOnline(target, qaSourceRef, { approved = autoUpdateBaselines, env = process.env, fetcher = fetch } = {}) {
  const [pair] = selectAutoUpdatePairs(target, qaSourceRef, approved);
  assert.equal(env.GITHUB_REPOSITORY, 'lwtlab/reader');
  assert.ok(env.GITHUB_TOKEN);
  const cache = new Map();
  function get(endpoint) {
    if (!cache.has(endpoint)) cache.set(endpoint, (async () => {
      const response = await fetcher(`https://api.github.com/repos/lwtlab/reader/${endpoint}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(30_000),
      });
      assert.ok(response.ok, `Authenticated upgrade candidate API: ${response.status}`);
      return response.json();
    })());
    return cache.get(endpoint);
  }
  for (const candidate of [pair.from, pair.to]) {
    const [run, artifact, jobs] = await Promise.all([
      get(`actions/runs/${candidate.run_id}`), get(`actions/artifacts/${candidate.artifact_id}`),
      get(`actions/runs/${candidate.run_id}/jobs?per_page=100`),
    ]);
    verifyAuthenticatedUpgradeCandidate(target, candidate, run, artifact, jobs.jobs);
  }
  return pair;
}

async function main() {
  if (process.env.AUTO_UPDATE_SELECT === 'true') {
    const matrix = selectAutoUpdatePairs(process.env.UPDATE_TARGET, process.env.QA_SOURCE_REF);
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
  } else {
    await verifyAutoUpdatePairOnline(process.env.UPDATE_TARGET, process.env.QA_SOURCE_REF);
    console.log('Both immutable authenticated upgrade candidates, source/version bindings, native producers and retained digests verified');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
