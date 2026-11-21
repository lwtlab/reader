import assert from 'node:assert/strict';
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {github,resolveInput,liveBinding,readReceipt} from './reader-verification-control.mjs';
import {BUILD_REPOSITORY,SOURCE_REPOSITORY,WORKFLOW,binding,positive} from './reader-verification.mjs';
import {MATRIX,CONTRACT,NATIVE_CONTEXT,NATIVE_ARTIFACT,NATIVE_JOB,nativeJob,nativeFingerprint,validateNativeJobs,validateNativeResult,validatePlatform} from './reader-native-tts-verification.mjs';
import {nativeRequired} from './reader-native-tts-contract.mjs';
const ep=p=>`repos/${SOURCE_REPOSITORY}/${p}`,pub=p=>`repos/${BUILD_REPOSITORY}/${p}`;
const url=(run,attempt)=>`https://github.com/${BUILD_REPOSITORY}/actions/runs/${positive(run)}/attempts/${positive(attempt)}`;
export async function latestNative(api,value){for(let page=1;page<=10;page++){const rows=await api(ep(`commits/${value.head}/statuses?per_page=100&page=${page}`));const status=rows.find(s=>s.context===NATIVE_CONTEXT);if(status)return status;if(rows.length<100)return null;}throw new Error('Status pagination limit');}
async function config(api,value,{optional=false}={}) {
  let data;try{data=await api(ep(`contents/release/native-tts-ci.json?ref=${value.tested}`));}catch(e){if(optional&&e.code==='HTTP_404')return null;throw e;}
  assert.equal(data.type,'file');assert.equal(data.encoding,'base64');assert(data.size>0&&data.size<=16384);const bytes=Buffer.from(data.content,'base64');assert.equal(bytes.length,data.size);
  const c=JSON.parse(bytes);assert.equal(c.schemaVersion,1);assert.equal(c.repository,BUILD_REPOSITORY);assert.equal(c.sourceRepository,SOURCE_REPOSITORY);assert.equal(c.workflow,WORKFLOW);assert.equal(c.ref,'reader-public-full-verification');assert.equal(c.workflowCommit,value.workflow);assert.equal(c.context,NATIVE_CONTEXT);assert.equal(c.contractSha256,CONTRACT);assert.equal(c.realModels,false);return c;
}
export async function applicability(api,value){
  if(!value.pr)return true;
  try {const commits=await Promise.all([value.base,value.tested].map(s=>api(ep(`git/commits/${s}`))));const trees=await Promise.all(commits.map(c=>api(ep(`git/trees/${c.tree.sha}?recursive=1`))));return nativeRequired(...trees);}
  catch{return true;}
}
export async function dispatchNativeIfNeeded(api,value){
  if(!await config(api,value,{optional:true}))return 'NOT_CONFIGURED';
  if(!await applicability(api,value))return 'NOT_APPLICABLE';
  const status=await latestNative(api,value),fingerprint=nativeFingerprint(value);
  if(status?.description?.endsWith(` ${fingerprint}`))return 'ALREADY_REQUESTED';
  const live=await liveBinding(api,value);assert.equal(live.head,value.head);assert.equal(live.base,value.base);
  await api(pub(`actions/workflows/${WORKFLOW}/dispatches`),'POST',{ref:'reader-public-full-verification',inputs:{source_ref:value.head,pr_number:String(value.pr),workflow_sha:value.workflow,scope:'native-tts'}});return 'DISPATCHED';
}
async function reportNative(api,value,{run,attempt,token}){
  const target=url(run,attempt),fingerprint=nativeFingerprint(value),status=await latestNative(api,value);
  if(status?.target_url!==target||status.description!==`native pending ${fingerprint}`)return 'SUPERSEDED';
  let state='error';
  try{
    const [actual,workflow,jobs,r]=await Promise.all([api(pub(`actions/runs/${run}`)),api(pub(`actions/workflows/${WORKFLOW}`)),api(pub(`actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`)),readReceipt(api,value,run,attempt,token,fetch,{prefix:NATIVE_ARTIFACT})]);
    assert.equal(actual.id,run);assert.equal(actual.run_attempt,attempt);assert.equal(actual.repository.full_name,BUILD_REPOSITORY);assert.equal(actual.head_sha,value.workflow);assert.equal(actual.workflow_id,workflow.id);assert.equal(actual.path,`.github/workflows/${WORKFLOW}`);assert.equal(actual.event,'workflow_dispatch');assert(['in_progress','completed'].includes(actual.status));assert(!['cancelled','skipped','timed_out'].includes(actual.conclusion));
    validateNativeResult(r,value,{run,attempt});assert(jobs.jobs.length<100);validateNativeJobs(jobs.jobs);state=r.status==='PASS'?'success':'failure';
  }catch{/* Missing, skipped, cancelled or mismatched evidence never becomes success. */}
  const current=await latestNative(api,value);if(current?.target_url!==target||current.description!==status.description)return 'SUPERSEDED';const live=await liveBinding(api,value);if(live.head!==value.head||live.base!==value.base)state='error';
  await api(ep(`statuses/${value.head}`),'POST',{context:NATIVE_CONTEXT,state,description:`native ${state==='success'?'PASS':state==='failure'?'FAIL':'invalid'} ${fingerprint}`,target_url:target});return state;
}
async function main(){
  assert.equal(process.env.GITHUB_REPOSITORY,BUILD_REPOSITORY);assert.equal(process.env.GITHUB_REF,'refs/heads/reader-public-full-verification');const api=github(process.env.GH_TOKEN),run=positive(process.env.GITHUB_RUN_ID),attempt=positive(process.env.GITHUB_RUN_ATTEMPT),operation=process.argv[2];
  if(['resolve','resolve-auth-probe'].includes(operation)){
    assert.equal(process.env.WORKFLOW_SHA,process.env.GITHUB_SHA);
    const value=await resolveInput(api,{source:process.env.SOURCE_REF,pr:Number(process.env.PR_NUMBER||0),workflow:process.env.GITHUB_SHA});const probe=operation==='resolve-auth-probe';if(!probe)await config(api,value);
    appendFileSync(process.env.GITHUB_OUTPUT,`binding=${JSON.stringify(value)}\ntested=${value.tested}\nmatrix=${JSON.stringify({include:probe?MATRIX.filter(m=>m.platform==='win32'):MATRIX})}\n`);
    if(probe){console.log('Trusted checkout-only diagnostic accepted; no verification status issued');return;}
    await api(ep(`statuses/${value.head}`),'POST',{context:NATIVE_CONTEXT,state:'pending',description:`native pending ${nativeFingerprint(value)}`,target_url:url(run,attempt)});console.log('Trusted native-only immutable input accepted');return;
  }
  const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));assert.equal(value.workflow,process.env.GITHUB_SHA);
  if(operation==='report'){console.log(`Native status: ${await reportNative(api,value,{run,attempt,token:process.env.GH_TOKEN})}`);return;}
  assert.equal(operation,'collect');
  const platforms=[];for(const m of MATRIX){let receipt=null;try{receipt=await readReceipt(api,value,run,attempt,process.env.GH_TOKEN,fetch,{prefix:`reader-native-tts-platform-${m.id}`});validatePlatform(receipt,value,{run,attempt,id:m.id});}catch{receipt=null;}platforms.push({id:m.id,receipt});}
  const jobs=await api(pub(`actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`));assert(jobs.jobs.length<100);
  const complete=MATRIX.every(m=>{const rows=jobs.jobs.filter(j=>j.name===nativeJob(m.id));return rows.length===1&&rows[0].status==='completed'&&rows[0].conclusion==='success';});
  const result={schemaVersion:1,kind:'reader-public-native-tts-verification',binding:value,run,attempt,contractSha256:CONTRACT,status:complete&&platforms.every(p=>p.receipt?.status==='PASS')?'PASS':'FAIL',platforms};validateNativeResult(result,value,{run,attempt});mkdirSync('native-tts-result',{mode:0o700,recursive:true});writeFileSync('native-tts-result/verification.json',JSON.stringify(result),{mode:0o600});console.log(`Native aggregate: ${result.status}; ${platforms.filter(p=>p.receipt?.status==='PASS').length}/7`);if(result.status!=='PASS')process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Native control failed; no success status issued');process.exitCode=1;});
