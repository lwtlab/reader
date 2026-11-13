import assert from 'node:assert/strict';
import {binding,fingerprint,positive} from './reader-verification.mjs';
import {CONTEXT,validatePlan,aggregate} from './selected-contract.mjs';
import {resolveSelected,checkExamplePlan} from './selected-input.mjs';
import {readSelectedArtifact} from './selected-artifacts.mjs';

export const SELECTED_JOBS={
  plan:'Selected source plan and controls',
  reader:'Selected Reader source verification',
  cpu:'Selected shared CPU compilation and controls',
  hear:'Selected Hear native and scripted GUI',
  aggregate:'Require selected source coverage',
};
const urlFor=(run,attempt)=>`https://github.com/lwtlab/reader/actions/runs/${run}/attempts/${attempt}`;
const pendingFor=value=>`selected pending ${fingerprint(value)}`;
async function latest(api,value){
  const rows=await api(`repos/lwtlab/lwt-core/commits/${value.head}/statuses?per_page=100`);
  assert(rows.length<100,'Paginated statuses are required');
  return rows.find(row=>row.context===CONTEXT);
}
function ownsPending(status,value,run,attempt){
  return status?.state==='pending'&&status.target_url===urlFor(run,attempt)&&status.description===pendingFor(value);
}
export function selectedJobOutcomes(jobs,hearRequired){
  assert(Array.isArray(jobs)&&jobs.length<100);
  const result={};
  for(const [key,name]of Object.entries(SELECTED_JOBS)){
    const rows=jobs.filter(job=>job.name===name);assert.equal(rows.length,1);
    assert.equal(rows[0].status,'completed');result[key]=rows[0].conclusion;
  }
  assert.equal(result.aggregate,'success');delete result.aggregate;
  assert.deepEqual(result,{plan:'success',reader:'success',cpu:'success',hear:hearRequired?'success':'skipped'});
  return result;
}
export function validateSelectedRun(actual,workflow,value,run,attempt,manifest){
  assert.equal(actual.id,positive(run));assert.equal(actual.run_attempt,positive(attempt));
  assert.equal(actual.repository.full_name,'lwtlab/reader');
  assert.equal(actual.event,'workflow_dispatch');assert.equal(actual.head_sha,value.workflow);
  assert.equal(actual.head_branch,manifest.publicBranch);
  assert((actual.status==='in_progress'&&actual.conclusion===null)||(actual.status==='completed'&&actual.conclusion==='success'),'A cancelled or failed public run cannot report success');
  assert.equal(actual.workflow_id,workflow.id);assert.equal(workflow.path,'.github/workflows/reader-private-verify.yml');
}
export async function collectSelected(api,value,{run,attempt,id,manifest,token,readArtifact=readSelectedArtifact}){
  const read=(prefix,names)=>readArtifact(api,value,{run,attempt,token,prefix,names});
  const planFiles=await read('plan',['plan.json']),planBytes=planFiles['plan.json'],plan=JSON.parse(planBytes);
  validatePlan(plan,value,run,attempt);checkExamplePlan(plan,id,manifest);
  const hearRequired=plan.selection.lanes[2].tasks.length>0;
  const coreRequired=plan.selection.lanes[1].coreTasks.length>0;
  const fullRequired=plan.selection.readerFullRequired;
  const [readerFiles,cpuFiles,hearFiles,qualificationFiles,jobs]=await Promise.all([
    read('reader',fullRequired?['selection.json','verification.json']:['selection.json']),
    read('cpu',coreRequired?['catalog.json','core.json','verification.json']:['catalog.json','verification.json']),
    hearRequired?read('hear',['verification.json']):null,
    read('qualification',['qualification.json']),
    api(`repos/lwtlab/reader/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`),
  ]);
  assert(jobs.total_count<100);
  const outcomes=selectedJobOutcomes(jobs.jobs,hearRequired);
  const bytes={plan:planBytes,reader:readerFiles['selection.json'],cpu:cpuFiles['verification.json'],catalog:cpuFiles['catalog.json'],
    core:coreRequired?cpuFiles['core.json']:null,hear:hearRequired?hearFiles['verification.json']:null,
    legacy:fullRequired?readerFiles['verification.json']:null};
  const records=Object.fromEntries(Object.entries(bytes).filter(([key])=>key!=='plan')
    .map(([key,data])=>[key,key==='legacy'?data:data?JSON.parse(data):null]));
  const result=aggregate(records,plan,value,run,attempt,outcomes,bytes);
  assert.deepEqual(JSON.parse(qualificationFiles['qualification.json']),result);
  return result;
}
export async function reportSelected(api,value,{run,attempt,id,manifest,token,readArtifact=readSelectedArtifact}){
  binding(value);positive(run);positive(attempt);
  const previous=await latest(api,value);
  if(!ownsPending(previous,value,run,attempt))return 'SUPERSEDED';
  let state='error',description=`selected invalid ${fingerprint(value)}`;
  try{
    const [actual,workflow,current]=await Promise.all([
      api(`repos/lwtlab/reader/actions/runs/${run}`),
      api('repos/lwtlab/reader/actions/workflows/reader-private-verify.yml'),
      resolveSelected(api,id,value.workflow,manifest),
    ]);
    assert.deepEqual(current,value);validateSelectedRun(actual,workflow,value,run,attempt,manifest);
    await collectSelected(api,value,{run,attempt,id,manifest,token,readArtifact});
    state='success';description=`selected PASS ${fingerprint(value)}`;
  }catch{
    // An absent, stale, failed or corrupt component cannot produce a green status.
  }
  try{
    assert.deepEqual(await resolveSelected(api,id,value.workflow,manifest),value);
    const [actual,workflow]=await Promise.all([api(`repos/lwtlab/reader/actions/runs/${run}`),api('repos/lwtlab/reader/actions/workflows/reader-private-verify.yml')]);
    validateSelectedRun(actual,workflow,value,run,attempt,manifest);
  }catch{state='error';description=`selected superseded ${fingerprint(value)}`;}
  const currentStatus=await latest(api,value);
  if(!ownsPending(currentStatus,value,run,attempt))return 'SUPERSEDED';
  await api(`repos/lwtlab/lwt-core/statuses/${value.head}`,'POST',{
    state,context:CONTEXT,description,target_url:urlFor(run,attempt),
  });
  return state;
}
