import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {CONTRACT,MATRIX,STEPS,nativeRequired} from './reader-native-tts-contract.mjs';
import {NATIVE_JOB,nativeJob,nativeFingerprint,validatePlatform,validateNativeResult,validateNativeJobs} from './reader-native-tts-verification.mjs';
import {dispatchNativeIfNeeded,applicability} from './reader-native-tts-control.mjs';
import {commands,executeSteps} from './reader-native-tts-run.mjs';
const value={head:'a'.repeat(40),base:'b'.repeat(40),tested:'c'.repeat(40),workflow:'d'.repeat(40),pr:331};
const result=()=>({schemaVersion:1,kind:'reader-public-native-tts-verification',binding:value,run:123,attempt:2,contractSha256:CONTRACT,status:'PASS',platforms:MATRIX.map(m=>({id:m.id,receipt:{schemaVersion:1,kind:'reader-native-tts-platform',binding:value,run:123,attempt:2,contractSha256:CONTRACT,id:m.id,host:{platform:m.platform,arch:m.arch,backend:m.backend},status:'PASS',summarySha256:'e'.repeat(64),diagnosticsSha256:'f'.repeat(64),build:{upstreamRevision:'1'.repeat(40),manifestSha256:'2'.repeat(64),binarySha256:'3'.repeat(64),librariesSha256:'4'.repeat(64)},steps:STEPS.map(id=>({id,status:'PASS',durationMs:1}))}}))});
const opts={run:123,attempt:2};
test('all seven independent typed platform receipts are mandatory',()=>{
  validateNativeResult(result(),value,opts);
  for(const mutate of [r=>r.platforms.pop(),r=>r.platforms.reverse(),r=>r.platforms[1]=r.platforms[0],r=>r.platforms[0].receipt=null,r=>r.platforms[0].receipt.host.arch='arm64',r=>r.platforms[0].receipt.binding={...value,tested:'9'.repeat(40)},r=>r.platforms[0].receipt.attempt=1,r=>r.platforms[0].receipt.steps.pop(),r=>r.platforms[0].receipt.steps[0].status='NOT_RUN',r=>r.platforms[0].receipt.diagnosticsSha256=null,r=>r.platforms[0].receipt.extra='private/path',r=>r.platforms[0].receipt.build=null,r=>r.contractSha256='0'.repeat(64)]){const r=result();mutate(r);assert.throws(()=>validateNativeResult(r,value,opts));}
  assert.throws(()=>validateNativeResult(result(),value,{run:123,attempt:3}));
  const failed=result();failed.status='FAIL';failed.platforms[1].receipt=null;validateNativeResult(failed,value,opts);
});
test('actual collector and every unique completed native job must succeed',()=>{
  const jobs=[NATIVE_JOB,...MATRIX.map(m=>nativeJob(m.id))].map(name=>({name,status:'completed',conclusion:'success'}));validateNativeJobs(jobs);
  for(const conclusion of ['failure','cancelled','skipped',null]){const bad=structuredClone(jobs);bad[1].conclusion=conclusion;assert.throws(()=>validateNativeJobs(bad));}
  assert.throws(()=>validateNativeJobs(jobs.slice(1)));assert.throws(()=>validateNativeJobs([...jobs,jobs[1]]));
});
test('commands preserve original PR contract without real models or extra submodules',()=>{
  for(const m of MATRIX){const sequence=commands(m,'/tmp/native-build');assert.equal(sequence.length,STEPS.length);assert.equal(sequence[5][4],m.backend);assert.equal(sequence[6].at(-1),'--help');assert(!JSON.stringify(sequence).includes('reader-models.py'));assert(!JSON.stringify(sequence).includes('--recursive'));}
  const workflow=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8');assert.match(workflow,/timeout-minutes: 45/);assert.match(workflow,/options: \[full, llama-cpu, native-tts, native-auth-probe\]/);assert.match(workflow,/if: inputs.scope == 'full' \|\| inputs.scope == ''/);
});
test('failed or interrupted commands leave downstream stages unrun',async()=>{
  for(const failure of [{code:1,signal:null},{code:null,signal:'SIGTERM'}]){
    const summary={steps:STEPS.map(id=>({id,status:'NOT_RUN',durationMs:null}))};let calls=0;await executeSteps(summary,Array(7).fill([]),{execute:async()=>++calls===2?failure:{code:0,signal:null},log:()=>{},save:()=>{}});assert.equal(calls,2);assert.equal(summary.steps[1].status,'FAIL');assert(summary.steps.slice(2).every(t=>t.status==='NOT_RUN'));
  }
});
function fixture({configured=true,changed=true,status=null,stale=false}={}){
  const calls=[];const api=async(endpoint,method='GET',body)=>{calls.push({endpoint,method,body});
    if(endpoint.includes('contents/release/native-tts-ci.json')){if(!configured)throw Object.assign(new Error('absent'),{code:'HTTP_404'});const content=Buffer.from(JSON.stringify({schemaVersion:1,repository:'lwtlab/reader',sourceRepository:'lwtlab/lwt-core',workflow:'reader-private-verify.yml',ref:'reader-public-full-verification',workflowCommit:value.workflow,context:'reader-public/native-tts',contractSha256:CONTRACT,realModels:false}));return {type:'file',encoding:'base64',content:content.toString('base64'),size:content.length};}
    if(endpoint.includes('/git/commits/'))return {tree:{sha:endpoint.endsWith(value.base)?'base':'tested'}};
    if(endpoint.includes('/git/trees/'))return {truncated:false,tree:endpoint.includes('tested')&&changed?[{path:'native/qwen3-tts/main.cpp',sha:'a'.repeat(40)}]:[]};
    if(endpoint.includes('/statuses?'))return status?[{context:'reader-public/native-tts',...status}]:[];
    if(endpoint.endsWith('/pulls/331'))return {state:'open',head:{sha:stale?'e'.repeat(40):value.head}};
    if(endpoint.endsWith('/git/ref/heads/main'))return {object:{sha:value.base}};
    if(endpoint.endsWith('/dispatches'))return null;
    throw new Error('Unexpected endpoint');
  };return {api,calls};
}
test('full broker dispatches native only for configured relevant immutable trees; dedup does not retry failures',async()=>{
  for(const [options,expected] of [[{},'DISPATCHED'],[{configured:false},'NOT_CONFIGURED'],[{changed:false},'NOT_APPLICABLE'],[{status:{description:`native FAIL ${nativeFingerprint(value)}`}},'ALREADY_REQUESTED']]){const f=fixture(options);assert.equal(await dispatchNativeIfNeeded(f.api,value),expected);assert.equal(f.calls.filter(c=>c.method==='POST').length,expected==='DISPATCHED'?1:0);if(expected==='DISPATCHED')assert.equal(f.calls.at(-1).body.inputs.scope,'native-tts');}
  await assert.rejects(()=>dispatchNativeIfNeeded(fixture({stale:true}).api,value));
  assert.equal(await applicability(async()=>{throw new Error('API unavailable')},value),true);
});
