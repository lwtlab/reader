import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {github,resolveInput,liveBinding,readReceipt} from './reader-verification-control.mjs';
import {binding,positive,BUILD_REPOSITORY,SOURCE_REPOSITORY,WORKFLOW} from './reader-verification.mjs';
import {profiles,profile,fingerprint,validateResult,RELIABILITY_ARTIFACT,RELIABILITY_JOB} from './reader-reliability-verification.mjs';
const source=p=>`repos/${SOURCE_REPOSITORY}/${p}`,pub=p=>`repos/${BUILD_REPOSITORY}/${p}`;
const url=(run,attempt)=>`https://github.com/${BUILD_REPOSITORY}/actions/runs/${positive(run)}/attempts/${positive(attempt)}`;
export async function latest(api,value,p){
  const context=profiles[profile(p)].context;
  for(let page=1;page<=10;page++){
    const rows=await api(source(`commits/${value.head}/statuses?per_page=100&page=${page}`));
    assert(Array.isArray(rows)&&rows.length<=100);
    const match=rows.find(r=>r.context===context);if(match)return match;
    if(rows.length<100)return undefined;
  }
  throw new Error('Status history exceeds bounded pagination');
}
export async function pending(api,value,{profile:p,run,attempt}){await api(source(`statuses/${value.head}`),'POST',{state:'pending',context:profiles[profile(p)].context,description:`reliability pending ${fingerprint(value,p)}`,target_url:url(run,attempt)});}
export async function reportReliability(api,value,{profile:p,run,attempt,job,token,receipt=readReceipt}){
  profile(p);const target=url(run,attempt),id=fingerprint(value,p);
  const [actual,workflow,live,status]=await Promise.all([api(pub(`actions/runs/${positive(run)}`)),api(pub(`actions/workflows/${WORKFLOW}`)),liveBinding(api,value),latest(api,value,p)]);
  if(status?.target_url!==target||status.description!==`reliability pending ${id}`)return 'SUPERSEDED';
  let state='error';
  try{
    assert.equal(actual.id,run);assert.equal(actual.run_attempt,attempt);assert.equal(actual.repository.full_name,BUILD_REPOSITORY);assert.equal(actual.head_sha,value.workflow);assert.equal(actual.workflow_id,workflow.id);assert.equal(actual.event,'workflow_dispatch');
    const jobs=await api(pub(`actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`));assert(jobs.jobs.length<100);const matches=jobs.jobs.filter(j=>j.name===RELIABILITY_JOB);assert.equal(matches.length,1);assert.equal(matches[0].conclusion,job);
    const record=await receipt(api,value,run,attempt,token,fetch,{prefix:RELIABILITY_ARTIFACT});validateResult(record,value,{profile:p,run,attempt});
    if(live.head===value.head&&live.base===value.base)state=job==='success'&&record.status==='PASS'?'success':'failure';
  }catch{/* Cancelled, missing, corrupt, wrong-attempt evidence can never produce success. */}
  const current=await latest(api,value,p);if(current?.target_url!==target||current.description!==status.description)return 'SUPERSEDED';
  const now=await liveBinding(api,value);if(now.head!==value.head||now.base!==value.base)state='error';
  await api(source(`statuses/${value.head}`),'POST',{state,context:profiles[p].context,description:`reliability ${state==='success'?'PASS':state==='failure'?'FAIL':'invalid'} ${id}`,target_url:target});return state;
}
async function main(){
  assert.equal(process.env.GITHUB_REPOSITORY,BUILD_REPOSITORY);
  assert(['refs/heads/reader-public-full-verification','refs/heads/ci/reader-reliability-20261117'].includes(process.env.GITHUB_REF));
  assert.equal(process.env.WORKFLOW_SHA,process.env.GITHUB_SHA);
  const api=github(process.env.GH_TOKEN),p=profile(process.env.RELIABILITY_PROFILE);
  const options={profile:p,run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT)};
  if(process.argv[2]==='resolve'){
    const ref=process.env.GITHUB_REF.slice('refs/heads/'.length);
    assert.equal((await api(pub(`git/ref/heads/${ref}`))).object.sha,process.env.GITHUB_SHA);
    const value=await resolveInput(api,{source:process.env.SOURCE_REF,pr:Number(process.env.PR_NUMBER||0),workflow:process.env.GITHUB_SHA});
    await pending(api,value,options);
    appendFileSync(process.env.GITHUB_OUTPUT,`binding=${JSON.stringify(value)}\ntested=${value.tested}\n`);
    console.log('Trusted immutable reliability input accepted');return;
  }
  assert.equal(process.argv[2],'report');const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));assert.equal(value.workflow,process.env.GITHUB_SHA);
  console.log(`Reliability status: ${await reportReliability(api,value,{...options,job:process.env.VERIFICATION_JOB_RESULT,token:process.env.GH_TOKEN})}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Reliability controller failed; no success status issued');process.exitCode=1;});
