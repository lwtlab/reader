import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const SOURCE_REPOSITORY = 'lwtlab/lwt-core';
export const BUILD_REPOSITORY = 'lwtlab/reader';
export const CONTEXT = 'reader-public/full';
export const WORKFLOW = 'reader-private-verify.yml';
export const TASKS = ['internal-release-tests','model-pack-tests','unified-release-version','orchestrator-tests','orchestrator-lint','feedback-governance','reader-lint','reader-types','sync-core','provider-parity','reader-baseline','mobile-baseline','mobile-lint','mobile-types','runtime-assets','reader-unit','reader-browser-integration','reader-postgres','mobile-unit','mobile-scripts','application-build','application-offline','mobile-bundle-copy','mobile-bundle-compatibility','mobile-material-contract','web-application-build','web-production-build','web-prune','web-build-artifacts','web-spa','short-reliability','metro-android','metro-ios'];
export const digest = value => createHash('sha256').update(value).digest('hex');
export function sha(value) { assert.match(value ?? '', /^[a-f0-9]{40}$/); return value; }
export function positive(value) { const n = Number(value); assert(Number.isSafeInteger(n) && n > 0); return n; }
export function binding({head, base, tested, pr = 0, workflow}) {
  assert(Number.isSafeInteger(pr) && pr >= 0);
  return {head:sha(head),base:sha(base),tested:sha(tested),pr,workflow:sha(workflow)};
}
export const fingerprint = value => digest(JSON.stringify(binding(value))).slice(0,24);
export function resolvePullRequest(pr, source, workflow, policy, currentBase) {
  assert.equal(pr.state,'open'); assert.equal(pr.head.repo.full_name,SOURCE_REPOSITORY);
  assert.equal(pr.base.repo.full_name,SOURCE_REPOSITORY); assert.equal(pr.base.ref,'main');
  assert(policy.trustedAssociations.includes(pr.author_association));
  assert.equal(sha(source),pr.head.sha);
  assert.notEqual(pr.mergeable,false); assert(pr.merge_commit_sha,'Merge commit is not ready');
  return binding({head:pr.head.sha,base:sha(currentBase),tested:pr.merge_commit_sha,pr:positive(pr.number),workflow});
}
export function verifyMergeParents(commit, value) {
  assert.equal(commit.sha,value.tested);
  assert.deepEqual(commit.parents.map(p=>p.sha),[value.base,value.head]);
}
export function resultFromSummary(summary, value, execution, bytes) {
  const exactTasks = summary?.tasks?.length === TASKS.length && new Set(summary.tasks.map(t=>t.id)).size === TASKS.length && TASKS.every(id=>summary.tasks.some(t=>t.id===id));
  const passed = execution === 'success' && summary?.status === 'PASS' && summary.profile === 'full' && !summary.reusedFrom && exactTasks && summary.tasks.every(t=>t.status==='PASS' && t.exitCode===0) && summary.source?.head === value.tested && summary.source.dirty === false && JSON.stringify(summary.source) === JSON.stringify(summary.sourceAfter) && /^[a-f0-9]{64}$/.test(summary.inputs?.sha256 ?? '') && summary.inputs.sha256 === summary.inputsAfter?.sha256;
  return {schemaVersion:1,kind:'reader-public-full-verification',binding:binding(value),status:passed?'PASS':'FAIL',summarySha256:bytes?digest(bytes):null,tasks:TASKS.map(id=>{
    const task=summary?.tasks?.find(t=>t.id===id);
    return {id,status:['PASS','FAIL','NOT_RUN'].includes(task?.status)?task.status:'NOT_RUN',durationMs:Number.isFinite(task?.durationMs)&&task.durationMs>=0?task.durationMs:null};
  })};
}
export function validateResult(result,value) {
  assert.deepEqual(Object.keys(result).sort(),['schemaVersion','kind','binding','status','summarySha256','tasks'].sort());
  assert.equal(result.schemaVersion,1); assert.equal(result.kind,'reader-public-full-verification');
  assert.deepEqual(result.binding,binding(value)); assert(['PASS','FAIL'].includes(result.status));
  assert.equal(result.tasks.length,TASKS.length);
  assert.deepEqual(result.tasks.map(t=>t.id),TASKS);
  for(const task of result.tasks) {
    assert.deepEqual(Object.keys(task).sort(),['id','status','durationMs'].sort());
    assert(['PASS','FAIL','NOT_RUN'].includes(task.status));
    assert(task.durationMs===null || (Number.isFinite(task.durationMs)&&task.durationMs>=0));
  }
  if(result.status==='PASS') { assert.match(result.summarySha256,/^[a-f0-9]{64}$/); assert(result.tasks.every(t=>t.status==='PASS')); }
  else assert(result.summarySha256===null || /^[a-f0-9]{64}$/.test(result.summarySha256));
  return result;
}
export function reportState({result,value,job,run,expectedRun,attempt,workflowId,live,latest}) {
  assert.equal(run.id,positive(expectedRun)); assert.equal(run.run_attempt,positive(attempt));
  assert.equal(run.repository.full_name,BUILD_REPOSITORY); assert.equal(run.head_sha,value.workflow);
  assert.equal(run.workflow_id,workflowId); assert.equal(run.event,'workflow_dispatch');
  const url=`https://github.com/${BUILD_REPOSITORY}/actions/runs/${expectedRun}/attempts/${attempt}`;
  if(latest?.target_url!==url || latest?.description!==`full pending ${fingerprint(value)}`) return null;
  if(live.head!==value.head || live.base!==value.base) return {state:'error',description:`full superseded ${fingerprint(value)}`};
  validateResult(result,value);
  return {state:job==='success'&&result.status==='PASS'?'success':'failure',description:`full ${job==='success'&&result.status==='PASS'?'PASS':'FAIL'} ${fingerprint(value)}`};
}
export function dispatchNeeded(status,value) {
  const id=fingerprint(value);
  return !status || !status.description?.endsWith(` ${id}`);
}
