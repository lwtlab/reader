import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {github,liveBinding,readReceipt} from './reader-verification-control.mjs';
import {BUILD_REPOSITORY,SOURCE_REPOSITORY,WORKFLOW,binding,positive} from './reader-verification.mjs';
import {CPU_CONTEXT,CPU_ARTIFACT,CPU_JOB,cpuFingerprint,validateCpuResult,scope} from './llama-cpu-verification.mjs';
const endpoint=p=>`repos/${SOURCE_REPOSITORY}/${p}`,pub=p=>`repos/${BUILD_REPOSITORY}/${p}`;
const url=(run,attempt)=>`https://github.com/${BUILD_REPOSITORY}/actions/runs/${positive(run)}/attempts/${positive(attempt)}`;
async function latest(api,value){return (await api(endpoint(`commits/${value.head}/statuses?per_page=100`))).find(s=>s.context===CPU_CONTEXT);}
export async function pendingCpu(api,value,{run,attempt,mode='full'}){await api(endpoint(`statuses/${value.head}`),'POST',{state:'pending',context:CPU_CONTEXT,description:`cpu pending ${cpuFingerprint(value,mode)}`,target_url:url(run,attempt)});}
export async function reportCpu(api,value,{run,attempt,job,token,mode='full',receipt=readReceipt}){
  const target=url(run,attempt),fingerprint=cpuFingerprint(value,mode);
  const [actual,workflow,live,status]=await Promise.all([api(pub(`actions/runs/${positive(run)}`)),api(pub(`actions/workflows/${WORKFLOW}`)),liveBinding(api,value),latest(api,value)]);
  if(status?.target_url!==target||status.description!==`cpu pending ${fingerprint}`)return 'SUPERSEDED';
  let state='error';
  try{
    assert.equal(actual.id,positive(run));assert.equal(actual.run_attempt,positive(attempt));assert.equal(actual.repository.full_name,BUILD_REPOSITORY);assert.equal(actual.head_sha,value.workflow);assert.equal(actual.workflow_id,workflow.id);assert.equal(actual.event,'workflow_dispatch');
    const jobs=await api(pub(`actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`));assert(jobs.jobs.length<100);const matches=jobs.jobs.filter(j=>j.name===CPU_JOB);assert.equal(matches.length,1);assert.equal(matches[0].conclusion,job);
    const result=await receipt(api,value,run,attempt,token,fetch,{prefix:CPU_ARTIFACT});validateCpuResult(result,value,{run,attempt,mode});
    if(live.head===value.head&&live.base===value.base)state=job==='success'&&result.status==='PASS'?'success':'failure';
  }catch{/* Missing or invalid evidence is an error, never success. */}
  const current=await latest(api,value);if(current?.target_url!==target||current?.description!==status.description)return 'SUPERSEDED';
  const now=await liveBinding(api,value);if(now.head!==value.head||now.base!==value.base)state='error';
  await api(endpoint(`statuses/${value.head}`),'POST',{state,context:CPU_CONTEXT,description:`cpu ${state==='success'?'PASS':state==='failure'?'FAIL':'invalid'} ${fingerprint}`,target_url:target});return state;
}
async function main(){assert.equal(process.env.GITHUB_REPOSITORY,BUILD_REPOSITORY);assert.equal(process.env.GITHUB_REF,'refs/heads/reader-public-full-verification');const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));assert.equal(value.workflow,process.env.GITHUB_SHA);console.log(`CPU status: ${await reportCpu(github(process.env.GH_TOKEN),value,{run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT),job:process.env.VERIFICATION_JOB_RESULT,token:process.env.GH_TOKEN,mode:scope(process.env.VERIFICATION_SCOPE||'full')})}`);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('CPU reporter failed; no success status issued');process.exitCode=1});
