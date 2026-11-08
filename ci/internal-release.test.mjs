import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { exportSessions, releaseInputs } from './internal-release.mjs';
const source = 'a'.repeat(40), workflowSha = 'b'.repeat(40);
const valid = () => ({ plan: 'release/ci/0.26.0/plan.json', publish: false, workflowSha });
test('manual internal release inputs pin source, workflow, metadata and resume identity', () => {
  assert.deepEqual(releaseInputs(JSON.stringify(valid()), source, workflowSha), valid());
  const v = {...valid(), resume: {run: 123, attempt: 2}};
  assert.deepEqual(releaseInputs(JSON.stringify(v), source, workflowSha), v);
  for (const patch of [{plan: 'release/ci/../../secret.json'}, {plan: '/tmp/plan.json'}, {publish: 'true'}, {workflowSha: source}, {repository: 'other/repo'}, {resume: {run: 'latest', attempt: 1}}]) {
    assert.throws(() => releaseInputs(JSON.stringify({...valid(), ...patch}), source, workflowSha));
  }
});
test('state export preserves recovery identity and excludes locks, arbitrary fields and diagnostics', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-state-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(path.join(root, 'input/application'), {recursive: true});
  const state = {schemaVersion: 1, repository: 'lwtlab/lwt-core', owner: 'a'.repeat(36), fingerprint: 'b'.repeat(64), phase: 'uploading', releaseId: 123};
  writeFileSync(path.join(root, 'input/application/session.json'), JSON.stringify({...state, rawLog: 'PRIVATE_SENTINEL'}));
  exportSessions(path.join(root, 'input'), path.join(root, 'output'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'output/application/session.json'))), state);
});
test('release job stays manual, isolated from builds and cannot publish a public release', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8');
  assert.ok(!workflow.includes('pull_request_target'));
  const job = workflow.split('  internal-release:')[1];
  assert.ok(job.includes('environment: reader-internal-release'));
  assert.ok(job.includes('secrets.INTERNAL_RELEASE_PUBLISH_TOKEN'));
  assert.ok(job.includes('scripts/release-actions.mjs publish'));
  assert.ok(job.includes('cancel-in-progress: false'));
  assert.ok(!job.includes('contents: write'));
  assert.ok(!job.includes('gh release'));
  assert.ok(!workflow.split('  internal-release:')[0].includes('INTERNAL_RELEASE_PUBLISH_TOKEN'));
});
