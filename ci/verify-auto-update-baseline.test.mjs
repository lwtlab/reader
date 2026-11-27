import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectAutoUpdatePairs, verifyAuthenticatedUpgradeCandidate, verifyAutoUpdatePairOnline } from './verify-auto-update-baseline.mjs';

function fixture(target = 'darwin-arm64') {
  const os = { 'darwin-arm64': 'macos-15', 'darwin-x64': 'macos-15-intel', 'win32-x64': 'windows-latest', 'linux-x64': 'ubuntu-22.04' }[target];
  const candidate = { os, run_id: 101, artifact_id: 202, artifact_name: `reader-${target}-authenticated-candidate`, source_ref: '1'.repeat(40), workflow_ref: '2'.repeat(40), archive_digest: `sha256:${'3'.repeat(64)}`, version: '0.26.1', profile: 'core', update_policy: target.startsWith('darwin-') ? 'signed-stable-v1' : 'project-authenticated-v1' };
  const pair = { qa_source_ref: '7'.repeat(40), from: candidate, to: { ...candidate, run_id: 111, artifact_id: 212, source_ref: '4'.repeat(40), archive_digest: `sha256:${'5'.repeat(64)}`, version: '0.26.2' } };
  function evidence(item) {
    return {
      run: { id: item.run_id, status: 'completed', repository: { full_name: 'lwtlab/reader' }, head_repository: { full_name: 'lwtlab/reader' }, path: '.github/workflows/authenticate-desktop-updates.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: item.workflow_ref },
      artifact: { id: item.artifact_id, name: item.artifact_name, workflow_run: { id: item.run_id, head_sha: item.workflow_ref }, digest: item.archive_digest, expired: false },
      jobs: [{ name: `authenticate-${target}`, conclusion: 'success', steps: [
        { name: 'Verify final candidate before accessing the update key', conclusion: 'success', number: 1 },
        { name: 'Authenticate exact final update bytes', conclusion: 'success', number: 2 },
        { name: 'Audit authenticated payloads and channel before upload', conclusion: 'success', number: 3 },
        { name: 'Upload authenticated candidates without publishing an update feed', conclusion: 'success', number: 4 },
      ] }],
    };
  }
  return { target, pair, approved: { [target]: pair }, evidence };
}

for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
  test(`${target}: actual upgrade QA accepts only final authenticated producer artifacts`, () => {
    const { pair, evidence } = fixture(target);
    const value = evidence(pair.from);
    const invoke = input => verifyAuthenticatedUpgradeCandidate(target, pair.from, input.run, input.artifact, input.jobs);
    assert.equal(invoke(value), pair.from);
    for (const mutate of [
      item => { item.run.head_repository.full_name = 'foreign/fork'; },
      item => { item.run.repository.full_name = 'foreign/repository'; },
      item => { item.run.path = '.github/workflows/desktop-candidates.yml'; },
      item => { item.run.event = 'pull_request'; },
      item => { item.run.head_branch = 'unreviewed'; },
      item => { item.run.head_sha = '0'.repeat(40); },
      item => { item.jobs[0].name = 'authenticate-other-target'; },
      item => { item.jobs[0].conclusion = 'failure'; },
      item => { item.jobs[0].steps[0].conclusion = 'skipped'; },
      item => { item.jobs[0].steps[1].conclusion = 'failure'; },
      item => { item.jobs[0].steps[2].conclusion = 'skipped'; },
      item => { item.jobs[0].steps[3].conclusion = 'failure'; },
      item => { item.jobs[0].steps[2].number = 5; },
      item => { delete item.jobs[0].steps[3].number; },
      item => { item.artifact.id++; },
      item => { item.artifact.name = `reader-${target}-candidate`; },
      item => { item.artifact.workflow_run.id++; },
      item => { item.artifact.workflow_run.head_sha = '0'.repeat(40); },
      item => { item.artifact.digest = `sha256:${'0'.repeat(64)}`; },
      item => { item.artifact.expired = true; },
    ]) {
      const changed = structuredClone(value); mutate(changed); assert.throws(() => invoke(changed));
    }
  });
}

test('QA runner identity is pinned independently of both compiled sources, while packages require increasing stable versions', () => {
  const { target, pair, approved } = fixture();
  const [selected] = selectAutoUpdatePairs('all', pair.qa_source_ref, approved);
  assert.notEqual(selected.qa_source_ref, selected.from.source_ref);
  assert.notEqual(selected.qa_source_ref, selected.to.source_ref);
  assert.equal(selected.os, 'macos-15');
  assert.equal(selected.arch, 'arm64');
  assert.throws(() => selectAutoUpdatePairs('all', pair.qa_source_ref, {}), /No approved authenticated upgrade pairs/);
  assert.throws(() => selectAutoUpdatePairs(target, pair.from.source_ref, approved), /reviewed runner/);
  assert.throws(() => selectAutoUpdatePairs(target, 'main', approved), /Immutable QA source/);
  for (const mutate of [
    item => { item.to.version = item.from.version; },
    item => { item.to.version = '0.25.9'; },
    item => { item.to.version = '0.26.2-beta'; },
    item => { item.to.source_ref = item.from.source_ref; },
    item => { item.to.artifact_id = item.from.artifact_id; },
    item => { item.to.os = 'self-hosted'; },
    item => { item.from.update_policy = 'disabled'; },
    item => { item.to.artifact_name = 'reader-darwin-arm64-signed-candidate'; },
    item => { item.to.workflow_ref = 'main'; },
  ]) {
    const changed = structuredClone(pair); mutate(changed);
    assert.throws(() => selectAutoUpdatePairs(target, pair.qa_source_ref, { [target]: changed }));
  }
});

test('online verification reads and validates both complete immutable producer sets, failing closed on the second archive', async () => {
  const { target, pair, approved, evidence } = fixture('linux-x64');
  const env = { GITHUB_REPOSITORY: 'lwtlab/reader', GITHUB_TOKEN: 'original-synthetic-read-token' };
  let expired = false;
  const requested = [];
  async function fetcher(url) {
    requested.push(url);
    const candidate = url.includes(String(pair.to.run_id)) || url.includes(String(pair.to.artifact_id)) ? pair.to : pair.from;
    const value = evidence(candidate);
    if (candidate === pair.to && expired) value.artifact.expired = true;
    return { ok: true, json: async () => url.includes('/artifacts/') ? value.artifact : url.includes('/jobs?') ? { jobs: value.jobs } : value.run };
  }
  const result = await verifyAutoUpdatePairOnline(target, pair.qa_source_ref, { approved, env, fetcher });
  assert.equal(result.from.artifact_id, pair.from.artifact_id);
  assert.equal(result.to.artifact_id, pair.to.artifact_id);
  assert.equal(requested.length, 6);
  expired = true;
  await assert.rejects(verifyAutoUpdatePairOnline(target, pair.qa_source_ref, { approved, env, fetcher }));
  await assert.rejects(verifyAutoUpdatePairOnline(target, pair.qa_source_ref, { approved, env, fetcher: async () => ({ ok: false, status: 403 }) }), /API: 403/);
});

for (const [lineEnding, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) test(`actual QA workflow separates read-only runner source, signing-free execution and scanned receipt publication (${lineEnding})`, () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-auto-update-acceptance.yml', import.meta.url), 'utf8').replace(/\r?\n/gu, newline);
  assert.equal((workflow.match(/if: github\.ref == 'refs\/heads\/main'/g) ?? []).length, 2);
  assert.match(workflow, /contents: read\r?\n  actions: read/);
  assert.ok(!workflow.includes('SIGNING_KEY') && !workflow.includes('macos-signing') && !workflow.includes('secrets.GITHUB_TOKEN'));
  assert.ok(!workflow.includes('READER_TEST_NO_SANDBOX') && !workflow.includes('READER_DESKTOP_USER_DATA_DIR'));
  assert.match(workflow, /ref: \$\{\{ inputs\.source_ref \}\}/);
  assert.match(workflow, /run-id: \$\{\{ matrix\.from\.run_id \}\}/);
  assert.match(workflow, /run-id: \$\{\{ matrix\.to\.run_id \}\}/);
  assert.match(workflow, /scripts\/smoke-desktop-auto-update\.mjs/);
  assert.equal((workflow.match(/scripts\/smoke-desktop-actual-update\.mjs/g) ?? []).length, 2);
  assert.ok(workflow.includes('xdotool wmctrl'));
  const audit = workflow.indexOf('- name: Audit exact actual-upgrade receipt before upload');
  const upload = workflow.indexOf('- name: Upload qualified actual-upgrade receipt only');
  assert.ok(audit > 0 && upload > audit);
  assert.match(workflow, /path: acceptance\/desktop-auto-update-acceptance\.json/);
  assert.ok(!workflow.includes('path: from-candidate/*') && !workflow.includes('path: to-candidate/*'));
  const authentication = readFileSync(new URL('../.github/workflows/authenticate-desktop-updates.yml', import.meta.url), 'utf8');
  for (const name of fixture().evidence(fixture().pair.from).jobs[0].steps.map(step => step.name)) assert.ok(authentication.includes(`- name: ${name}`), `Pinned producer gate drifted: ${name}`);
});
