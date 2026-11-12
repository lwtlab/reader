import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { aggregate, ALL_TASKS, exampleFor, HEAR_CONTRACT, HEAR_EXECUTOR, HEAR_TASKS, resolveExample, selectedIds, validateExamplePlan, fullCompanion, READER_CONTRACT } from './change-examples.mjs';
import { binding, digest, TASKS, resultFromSummary } from './reader-verification.mjs';
import { PINS, planResult } from './shadow-plan.mjs';
import { CPU_TASKS, cpuResult } from './llama-cpu-verification.mjs';
import { catalogResult } from './cpu-catalog.mjs';
const ids=['reader-only','hear-only','shared-core','unknown'],outcomes={plan:'success',full:'success',cpu:'success',hear:'success'},run=123,attempt=1;
function fixture(id='unknown', suppliedManifest) {
  const manifest=suppliedManifest??{schemaVersion:1,baseBranch:'reviewed-base',base:'b'.repeat(40),publicBranch:'ci/generated-example',hearAdapter:'e'.repeat(40),examples:ids.map((id,index)=>({id,branch:`generated-${id}`,head:String(index+1).repeat(40),changesSha256:digest(id),pr:300+index,products:id==='reader-only'?['reader']:id==='hear-only'?['hear']:['reader','hear']}))};
  const e=manifest.examples.find(e=>e.id===id),value=binding({head:e.head,base:manifest.base,tested:'c'.repeat(40),workflow:'d'.repeat(40),pr:e.pr});
  const plan=planResult(null,value,run,attempt,{});
  Object.assign(plan,{status:'PASS',validation:'PASS',catalogSha256:PINS.catalogSha256,summarySha256:'f'.repeat(64),planSha256:'a'.repeat(64),changesSha256:e.changesSha256,changeMetadata:'complete',products:e.products,plannedTasks:selectedIds(id).map(id=>({id,status:'NOT_RUN'})),controls:ids.map(id=>({id,kind:'generated-git-control',status:'PASS'})),execution:{controls:'success',plan:'success'}});
  const source={head:value.tested,dirty:false,inputHash:'e'.repeat(64),submodules:[]},inputs={sha256:'f'.repeat(64)};
  const fullSummary={schemaVersion:1,kind:'synthetic-repository-verification',runId:'11111111-1111-4111-8111-111111111111',profile:'full',invocation:'verify',status:'PASS',source,sourceAfter:structuredClone(source),inputs,inputsAfter:structuredClone(inputs),startedAt:new Date(2000).toISOString(),endedAt:new Date(3000).toISOString(),graphStartedAt:new Date(2500).toISOString(),durationMs:1000,preparationDurationMs:500,tasks:TASKS.map(id=>({id,status:'PASS',exitCode:0,durationMs:1})),catalogExecution:{policy:'reader-hear-source-execution-v1',scope:'reader',profile:'full',selectionApplied:false,contractSha256:READER_CONTRACT,status:'PASS',tasks:TASKS.map(id=>({id,status:'PASS'}))}};
  const summaryBytes=Buffer.from(JSON.stringify(fullSummary)),full=resultFromSummary(fullSummary,value,'success',summaryBytes),fullExecution=fullCompanion(summaryBytes,Buffer.from(JSON.stringify(full)),value,{run,attempt,execution:'success',preparationStartedAt:1000,now:4000});
  const legacy=cpuResult(null,value,{run,attempt,mode:'llama-cpu',execution:'failure'});Object.assign(legacy,{status:'PASS',summarySha256:'f'.repeat(64),diagnosticsSha256:'e'.repeat(64),build:{upstreamRevision:'a'.repeat(40),manifestSha256:'b'.repeat(64),runtimeSha256:'c'.repeat(64),bundleSha256:'d'.repeat(64),fileCount:19},tasks:CPU_TASKS.map(({id})=>({id,status:'PASS',durationMs:1}))});
  const catalog=catalogResult(null,null,null,null,value,{run,attempt,execution:'failure'});Object.assign(catalog,{status:'PASS',summarySha256:legacy.summarySha256,legacyReceiptSha256:digest(JSON.stringify(legacy)),tasks:CPU_TASKS.map(({id})=>({id,status:'PASS'})),acceptance:{...catalog.acceptance,cpuCompilation:'PASS'}});
  const hear={schemaVersion:1,kind:'hear-shared-desktop-verification',diagnostic:true,releaseAcceptance:false,headRef:value.head,baseRef:value.base,testedRef:value.tested,workflowRef:value.workflow,prNumber:value.pr,runId:run,runAttempt:attempt,platform:'darwin-arm64',appPath:'apps/hear',policy:'reader-hear-source-execution-v1',scope:'hear-desktop',profile:'full',selectionApplied:false,contractSha256:HEAR_CONTRACT,executorGraphSha256:HEAR_EXECUTOR,summarySha256:'f'.repeat(64),nativeOrigin:{schemaVersion:1,kind:'hear-native-build',coreRef:value.tested,clean:true,platform:'darwin',arch:'arm64',napi:'10',filename:'hear-core.darwin-arm64.node',sha256:'e'.repeat(64)},status:'PASS',validation:'PASS',executionOutcome:'success',tasks:HEAR_TASKS.map(id=>({id,status:'PASS',durationMs:1})),tests:{unit:{passed:1,failed:0,skipped:0},gui:{passed:1,failed:0,skipped:0}},preparationDurationMs:1,executionDurationMs:7,acceptance:{nativeCompilation:'PASS',scriptedGui:'PASS',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'},diagnostics:{log:'a'.repeat(64),native:'b'.repeat(64),summary:'c'.repeat(64)}};
  return {manifest,value,records:{plan,full,fullExecution,legacy,catalog,hear},id,fullSummary};
}
function encoded(f){return Object.fromEntries(Object.entries(f.records).map(([key,value])=>[key,Buffer.from(JSON.stringify(value))]));}
const result=(f,actual=outcomes)=>aggregate(encoded(f),f.value,run,attempt,f.id,actual,f.manifest);
test('four real classes require all49 actual executions while preserving shadow plans and full33',()=>{
  for(const id of ids){const f=fixture(id),r=result(f);assert.equal(r.status,'PASS');assert.equal(r.executedTasks.length,49);assert.deepEqual(r.executedTasks.map(t=>t.id),ALL_TASKS);assert.equal(r.selectedTasks.length,id==='reader-only'?44:id==='hear-only'?30:49);assert.equal(r.selectionApplied,false);assert.equal(r.acceptance.modelInference,'NOT_RUN');assert.equal(r.acceptance.signedInstallation,'NOT_RUN');assert.equal(r.acceptance.physicalAudio,'NOT_RUN');assert.equal(f.records.plan.plannedTasks[0].status,'NOT_RUN');}
});
test('foreign source, run, attempt, policy, partial tasks or private receipt fields cannot qualify',()=>{
 for(const mutate of [f=>f.records.plan.run++,f=>f.records.plan.binding.head='e'.repeat(40),f=>f.records.plan.changesSha256='0'.repeat(64),f=>f.records.plan.products=['reader'],f=>f.records.plan.plannedTasks.pop(),f=>f.records.plan.plannedTasks[0].status='PASS',f=>f.records.plan.execution.plan='skipped',f=>f.records.fullExecution.run++,f=>f.records.fullExecution.attempt++,f=>f.records.fullExecution.summarySha256='0'.repeat(64),f=>f.records.fullExecution.legacyReceiptSha256='0'.repeat(64),f=>f.records.full.tasks.pop(),f=>f.records.full.tasks[0].status='NOT_RUN',f=>f.records.full.private='PRIVATE',f=>f.records.catalog.executorContractSha256='0'.repeat(64),f=>f.records.catalog.legacyReceiptSha256='0'.repeat(64),f=>f.records.catalog.tasks.pop(),f=>f.records.legacy.attempt++,f=>f.records.hear.runId++,f=>f.records.hear.workflowRef='e'.repeat(40),f=>f.records.hear.tasks[0].status='FAIL',f=>f.records.hear.nativeOrigin.clean=false,f=>f.records.hear.contractSha256='0'.repeat(64),f=>f.records.hear.tasks[0].output='PRIVATE',f=>f.records.hear.acceptance.physicalAudio='PASS']){const f=fixture();mutate(f);const r=result(f);assert.equal(r.status,'FAIL');assert(r.executedTasks.every(t=>t.status==='NOT_RUN'));assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);}
 for(const key of Object.keys(outcomes))for(const status of ['failure','cancelled','skipped','unknown'])assert.equal(result(fixture(),{...outcomes,[key]:status}).status,'FAIL');
 const f=fixture(),bytes=encoded(f);delete bytes.full;assert.equal(aggregate(bytes,f.value,run,attempt,f.id,outcomes,f.manifest).status,'FAIL');
});
test('same-source full receipt from an older run or attempt cannot qualify a fresh aggregate',()=>{
 for(const change of ['run','attempt']){
  const f=fixture();let nextRun=run,nextAttempt=attempt;
  if(change==='run')nextRun++;else nextAttempt++;
  f.records.plan.run=nextRun;f.records.plan.attempt=nextAttempt;
  f.records.legacy.run=nextRun;f.records.legacy.attempt=nextAttempt;
  f.records.catalog.run=nextRun;f.records.catalog.attempt=nextAttempt;f.records.catalog.legacyReceiptSha256=digest(JSON.stringify(f.records.legacy));
  f.records.hear.runId=nextRun;f.records.hear.runAttempt=nextAttempt;
  assert.equal(aggregate(encoded(f),f.value,nextRun,nextAttempt,f.id,outcomes,f.manifest).status,'FAIL');
 }
 const f=fixture(),summaryBytes=Buffer.from(JSON.stringify(f.fullSummary)),legacyBytes=Buffer.from(JSON.stringify(f.records.full));
 assert.equal(fullCompanion(summaryBytes,legacyBytes,f.value,{run:124,attempt:2,execution:'success',preparationStartedAt:3500,now:4000}).status,'FAIL');
 for(const mutate of [s=>s.catalogExecution.contractSha256='0'.repeat(64),s=>s.runId='stale',s=>s.reusedFrom={},s=>s.inputsAfter.sha256='0'.repeat(64),s=>s.sourceAfter.dirty=true,s=>s.cleanupFailure='PRIVATE']){
  const g=structuredClone(f.fullSummary);mutate(g);assert.equal(fullCompanion(Buffer.from(JSON.stringify(g)),legacyBytes,f.value,{run,attempt,execution:'success',preparationStartedAt:1000,now:4000}).status,'FAIL');
 }
});
test('trusted nested PR, exact reviewed head/base and actual merge parents are mandatory',async()=>{
 const f=fixture('hear-only'),e=exampleFor(f.id,f.manifest);
 const pull={number:e.pr,state:'open',head:{sha:e.head,ref:e.branch,repo:{full_name:'lwtlab/lwt-core'}},base:{ref:f.manifest.baseBranch,repo:{full_name:'lwtlab/lwt-core'}},author_association:'OWNER',mergeable:true,merge_commit_sha:f.value.tested};
 const api=async endpoint=>endpoint.includes('/pulls/')?pull:endpoint.includes('/git/ref/')?{object:{sha:f.manifest.base}}:{sha:f.value.tested,parents:[{sha:f.value.base},{sha:f.value.head}]};
 assert.deepEqual(await resolveExample(api,f.id,f.value.workflow,f.manifest),f.value);
 for(const change of [p=>p.state='closed',p=>p.author_association='CONTRIBUTOR',p=>p.head.repo.full_name='other/repo',p=>p.head.sha='e'.repeat(40),p=>p.base.ref='main',p=>p.mergeable=false]){const changed=structuredClone(pull);change(changed);await assert.rejects(resolveExample(async endpoint=>endpoint.includes('/pulls/')?changed:api(endpoint),f.id,f.value.workflow,f.manifest));}
 await assert.rejects(resolveExample(async endpoint=>endpoint.includes('/git/commits/')?{sha:f.value.tested,parents:[{sha:f.value.head},{sha:f.value.base}]}:api(endpoint),f.id,f.value.workflow,f.manifest));
 assert.throws(()=>exampleFor('unreviewed',f.manifest));
});
test('actual aggregate CLI writes a failed closed receipt for missing input, never product PASS',t=>{
 const root=mkdtempSync(join(tmpdir(),'change-aggregate-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 // Pure aggregation is also exercised through its actual public CLI with the reviewed manifest.
 const manifest=JSON.parse(readFileSync(new URL('./change-examples.json',import.meta.url)));assert(manifest.examples.every(e=>e.pr>0));
 const e=manifest.examples[0],value=binding({head:e.head,base:manifest.base,tested:'c'.repeat(40),workflow:'d'.repeat(40),pr:e.pr});
 const cli=new URL('./change-examples.mjs',import.meta.url).pathname;
 const child=spawnSync(process.execPath,[cli,'aggregate'],{cwd:root,env:{...process.env,GITHUB_REPOSITORY:'lwtlab/reader',GITHUB_REF:`refs/heads/${manifest.publicBranch}`,GITHUB_SHA:value.workflow,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',CHANGE_EXAMPLE:e.id,VERIFICATION_BINDING:JSON.stringify(value),CHANGE_OUTCOMES:JSON.stringify(outcomes)},encoding:'utf8'});
 assert.equal(child.status,1);assert.doesNotMatch(child.stdout+child.stderr,/PRIVATE|Error:|change-aggregate-/);const r=JSON.parse(readFileSync(join(root,'change-result/qualification.json')));assert.equal(r.status,'FAIL');assert(r.executedTasks.every(t=>t.status==='NOT_RUN'));
});
test('actual aggregate CLI validates complete receipts and rejects a tampered input',t=>{
 const manifest=JSON.parse(readFileSync(new URL('./change-examples.json',import.meta.url))),id=manifest.examples[0].id,f=fixture(id,manifest);
 const root=mkdtempSync(join(tmpdir(),'change-valid-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const paths={plan:'plan/verification.json',full:'full/verification.json',fullExecution:'full/full-execution.json',legacy:'cpu/verification.json',catalog:'cpu/catalog.json',hear:'hear/verification.json'};
 const cli=new URL('./change-examples.mjs',import.meta.url).pathname;
 for(const corrupt of [false,true]){
  const directory=join(root,corrupt?'corrupt':'valid');mkdirSync(directory);
  const bytes=encoded(f);if(corrupt)bytes.fullExecution=Buffer.from(JSON.stringify({...f.records.fullExecution,run:run-1}));
  for(const [key,name]of Object.entries(paths)){const file=join(directory,'change-inputs',name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,bytes[key]);}
  const child=spawnSync(process.execPath,[cli,'aggregate'],{cwd:directory,env:{...process.env,GITHUB_REPOSITORY:'lwtlab/reader',GITHUB_REF:`refs/heads/${manifest.publicBranch}`,GITHUB_SHA:f.value.workflow,GITHUB_RUN_ID:String(run),GITHUB_RUN_ATTEMPT:String(attempt),CHANGE_EXAMPLE:id,VERIFICATION_BINDING:JSON.stringify(f.value),CHANGE_OUTCOMES:JSON.stringify(outcomes)},encoding:'utf8'});
  assert.equal(child.status,corrupt?1:0);const r=JSON.parse(readFileSync(join(directory,'change-result/qualification.json')));assert.equal(r.status,corrupt?'FAIL':'PASS');assert.doesNotMatch(child.stdout+child.stderr,/PRIVATE|Error:|change-valid-cli-/);
 }
});
test('optional workflow isolates every execution and preserves old statuses and authoritative gates',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8');
 for(const name of ['resolve','full','report','llama-cpu','report-llama-cpu']){const block=yaml.slice(yaml.indexOf(`\n  ${name}:`)+1).split(/\n  [a-z][a-z-]+:/)[0];assert.match(block,/inputs.scope != 'change-example'/);}
 const optional=yaml.slice(yaml.indexOf('\n  resolve-example:'));
 assert.doesNotMatch(optional,/reader-verification-control.mjs report|llama-cpu-control|postStatus|pull_request_target|continue-on-error|submodules: recursive|SIGNING/);
 assert.match(optional,/Run the unchanged complete task graph/);assert.match(optional,/change-examples.mjs full-collect/);assert.match(optional,/change-examples.mjs full-require/);assert.match(optional,/full-execution.json/);assert.match(optional,/require-catalog/);assert.match(optional,/desktop-catalog.mjs --require-pass/);assert.match(optional,/3cf181b04a953e647ae28e54d0e5d5279f2f250a/);
 for(const prefix of ['plan','full','cpu','hear'])assert(optional.includes(`reader-change-${prefix}-result-`));
 assert.match(optional,/needs: \[resolve-example, example-plan, example-full, example-cpu, example-hear\]/);
 const collector=readFileSync(new URL('./change-examples.mjs',import.meta.url),'utf8');assert.doesNotMatch(collector,/statuses\/|actions\/workflows\/.*dispatches|postStatus/);
});
