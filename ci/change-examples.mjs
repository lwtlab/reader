// Optional source-bound qualification. Never writes the default full/CPU status contexts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binding, digest, positive, sha, TASKS, resultFromSummary, validateResult, verifyMergeParents } from './reader-verification.mjs';
import { github } from './reader-verification-control.mjs';
import { PINS, planIdentity, planResult, verifyImplementation, RELEASE_GATES } from './shadow-plan.mjs';
import { CPU_TASKS, CPU_CONTRACT, validateCpuResult } from './llama-cpu-verification.mjs';
import { CATALOG_CONTRACT, EXECUTOR_CONTRACT, EXECUTOR_POLICY, catalogResult } from './cpu-catalog.mjs';
import { encryptLog } from './log-crypto.mjs';

export const MANIFEST = JSON.parse(readFileSync(new URL('./change-examples.json', import.meta.url)));
export const HEAR_TASKS = ['hear-tools','hear-types','hear-unit','core-sources','core-asr-controls','hear-native','hear-gui'];
export const ALL_TASKS = [...TASKS, ...HEAR_TASKS, ...CPU_TASKS.map(t => t.id)];
export const HEAR_CONTRACT = '677f68bdf7fb8c8aae2e0764a0cd0df0ed491b86416d2f59834448f6915052fe';
export const HEAR_EXECUTOR = '430620770735c6fafaf2cf9895017286f47ec396f73c642317be17e0fdb8f81b';
const classes = ['reader-only','hear-only','shared-core','unknown'];
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');
const productsFor = id => id === 'reader-only' ? ['reader'] : id === 'hear-only' ? ['hear'] : ['reader','hear'];
export function exampleFor(id, manifest = MANIFEST) {
  assert.equal(manifest.schemaVersion, 1); sha(manifest.base); sha(manifest.hearAdapter);
  assert.deepEqual(manifest.examples.map(example => example.id), classes);
  assert(classes.includes(id));
  const example = manifest.examples.find(example => example.id === id);
  sha(example.head); positive(example.pr); assert(hex(example.changesSha256));
  assert.deepEqual(example.products, productsFor(id));
  return example;
}
export async function resolveExample(api, id, workflow, manifest = MANIFEST) {
  const example = exampleFor(id, manifest); sha(workflow);
  const [pull, base] = await Promise.all([
    api(`repos/lwtlab/lwt-core/pulls/${example.pr}`),
    api(`repos/lwtlab/lwt-core/git/ref/heads/${manifest.baseBranch}`),
  ]);
  assert.equal(base.object.sha, manifest.base);
  assert.equal(pull.state, 'open'); assert.equal(pull.number, example.pr);
  assert.equal(pull.head.repo.full_name, 'lwtlab/lwt-core');
  assert.equal(pull.base.repo.full_name, 'lwtlab/lwt-core');
  assert.equal(pull.base.ref, manifest.baseBranch); assert.equal(pull.head.ref, example.branch);
  assert(['OWNER','MEMBER','COLLABORATOR'].includes(pull.author_association));
  assert.equal(pull.head.sha, example.head); assert.equal(pull.mergeable, true);
  const value = binding({ head: example.head, base: manifest.base, tested: pull.merge_commit_sha, pr: example.pr, workflow });
  verifyMergeParents(await api(`repos/lwtlab/lwt-core/git/commits/${value.tested}`), value);
  return value;
}
export function selectedIds(id) {
  if (id === 'reader-only') return [...TASKS, 'core-sources','core-asr-controls', ...CPU_TASKS.map(t => t.id)];
  if (id === 'hear-only') return [...TASKS.slice(0,14), ...HEAR_TASKS, ...CPU_TASKS.map(t => t.id)];
  assert(classes.includes(id)); return ALL_TASKS;
}
export function validateExamplePlan(result, value, run, attempt, id, manifest = MANIFEST) {
  const example = exampleFor(id, manifest);
  assert.deepEqual(Object.keys(result).sort(), Object.keys(planResult(null, value, run, attempt, {})).sort());
  assert.equal(value.head, example.head); assert.equal(value.base, manifest.base); assert.equal(value.pr, example.pr);
  assert.deepEqual(result.binding, binding(value)); assert.equal(result.run, run); assert.equal(result.attempt, attempt);
  assert.equal(result.kind, 'reader-hear-shadow-plan-qualification'); assert.equal(result.schemaVersion, 1);
  assert.equal(result.policy, 'reader-hear-shadow-v2'); assert.equal(result.profile, 'full');
  assert.equal(result.status, 'PASS'); assert.equal(result.validation, 'PASS');
  assert.equal(result.shadowOnly, true); assert.equal(result.selectionApplied, false);
  assert.equal(result.catalogSha256, PINS.catalogSha256); assert.equal(result.changeMetadata, 'complete');
  assert.equal(result.changesSha256, example.changesSha256);
  assert.deepEqual(result.products, example.products);
  for (const key of ['summarySha256','planSha256']) assert(hex(result[key]));
  assert.deepEqual(result.execution, {controls:'success',plan:'success'});
  assert.deepEqual(result.controls, classes.map(id => ({id,kind:'generated-git-control',status:'PASS'})));
  assert.deepEqual(result.plannedTasks, selectedIds(id).map(id => ({id,status:'NOT_RUN'})));
  assert.deepEqual(result.mandatoryReaderTasks, TASKS.map(id => ({id,status:'NOT_RUN'})));
  assert.deepEqual(result.releaseGates, RELEASE_GATES.map(id => ({id,status:'NOT_RUN'})));
  assert.deepEqual(result.acceptance, {sourceExecution:'NOT_RUN',nativeCompilation:'NOT_RUN',scriptedGui:'NOT_RUN',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'});
  return result;
}
function duration(value) { assert(Number.isSafeInteger(value) && value >= 0 && value <= 7 * 24 * 3600000); }
export function validateHear(result, value, run, attempt) {
  const keys = ['schemaVersion','kind','diagnostic','releaseAcceptance','headRef','baseRef','testedRef','workflowRef','prNumber','runId','runAttempt','platform','appPath','policy','scope','profile','selectionApplied','contractSha256','executorGraphSha256','summarySha256','nativeOrigin','status','validation','executionOutcome','tasks','tests','preparationDurationMs','executionDurationMs','acceptance','diagnostics'];
  assert.deepEqual(Object.keys(result).sort(), keys.sort());
  assert.equal(result.schemaVersion,1); assert.equal(result.kind,'hear-shared-desktop-verification');
  for (const [key, expected] of Object.entries({headRef:value.head,baseRef:value.base,testedRef:value.tested,workflowRef:value.workflow,prNumber:value.pr,runId:run,runAttempt:attempt,platform:'darwin-arm64',appPath:'apps/hear',policy:'reader-hear-source-execution-v1',scope:'hear-desktop',profile:'full',selectionApplied:false,diagnostic:true,releaseAcceptance:false,status:'PASS',validation:'PASS',executionOutcome:'success',contractSha256:HEAR_CONTRACT,executorGraphSha256:HEAR_EXECUTOR})) assert.equal(result[key], expected);
  assert(hex(result.summarySha256)); assert.deepEqual(result.tasks.map(t=>t.id),HEAR_TASKS);
  for (const task of result.tasks) { assert.deepEqual(Object.keys(task).sort(),['id','status','durationMs'].sort()); assert.equal(task.status,'PASS'); duration(task.durationMs); }
  for (const key of ['preparationDurationMs','executionDurationMs']) duration(result[key]);
  const native=result.nativeOrigin;
  assert.deepEqual(Object.keys(native).sort(),['schemaVersion','kind','coreRef','clean','platform','arch','napi','filename','sha256'].sort());
  assert.equal(native.schemaVersion,1);assert.equal(native.kind,'hear-native-build');assert.equal(native.coreRef,value.tested);assert.equal(native.clean,true);assert.equal(native.platform,'darwin');assert.equal(native.arch,'arm64');assert.equal(native.napi,'10');assert.equal(native.filename,'hear-core.darwin-arm64.node');assert(hex(native.sha256));
  assert.deepEqual(Object.keys(result.tests).sort(),['unit','gui'].sort());
  for (const test of Object.values(result.tests)) { assert.deepEqual(Object.keys(test).sort(),['passed','failed','skipped'].sort());positive(test.passed);assert.equal(test.failed,0);assert(Number.isSafeInteger(test.skipped)&&test.skipped>=0); }
  assert.deepEqual(result.acceptance,{nativeCompilation:'PASS',scriptedGui:'PASS',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'});
  assert.deepEqual(Object.keys(result.diagnostics).sort(),['log','native','summary']);assert(Object.values(result.diagnostics).every(hex));
  return result;
}
export const READER_CONTRACT = '1ccb65dd713e5e4a3c79b3a6143b00c00fcc1d4b679ae7e0d34e28aace8d104a';
export function fullCompanion(summaryBytes, legacyBytes, value, {run,attempt,execution,preparationStartedAt,now=Date.now()}) {
  const result={schemaVersion:1,kind:'reader-change-full-execution',binding:binding(value),run:positive(run),attempt:positive(attempt),policy:'reader-hear-source-execution-v1',scope:'reader',profile:'full',selectionApplied:false,contractSha256:READER_CONTRACT,status:'FAIL',summarySha256:null,legacyReceiptSha256:null,tasks:TASKS.map(id=>({id,status:'NOT_RUN'})),preparationDurationMs:null,graphDurationMs:null};
  try {
    assert(Buffer.isBuffer(summaryBytes)&&summaryBytes.length<=5*1024*1024&&Buffer.isBuffer(legacyBytes)&&legacyBytes.length<=65536);
    const summary=JSON.parse(summaryBytes),legacy=JSON.parse(legacyBytes);
    validateResult(legacy,value);assert.equal(legacy.status,'PASS');assert.equal(execution,'success');
    assert.deepEqual(resultFromSummary(summary,value,execution,summaryBytes),legacy);
    assert.equal(summary.kind,'synthetic-repository-verification');assert.equal(summary.schemaVersion,1);assert.equal(summary.invocation,'verify');
    assert.match(summary.runId??'',/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    for(const key of ['failure','sourceFailure','cleanupFailure','executionFailure'])assert(!summary[key]);
    const begin=Date.parse(summary.startedAt),end=Date.parse(summary.endedAt),graph=Date.parse(summary.graphStartedAt);
    assert(Number.isSafeInteger(preparationStartedAt)&&preparationStartedAt>0&&begin>=preparationStartedAt&&begin<=now&&end>=begin&&end<=now+1000&&end-begin<=120*60*1000);
    assert.equal(summary.durationMs,end-begin);assert(graph>=begin&&graph<=end);assert.equal(summary.preparationDurationMs,graph-begin);
    const coverage=summary.catalogExecution;
    assert.deepEqual(coverage,{policy:result.policy,scope:'reader',profile:'full',selectionApplied:false,contractSha256:READER_CONTRACT,status:'PASS',tasks:TASKS.map(id=>({id,status:'PASS'}))});
    assert.deepEqual(summary.tasks.map(t=>t.id),TASKS);assert(summary.tasks.every(t=>t.exitCode===0&&t.status==='PASS'));assert(summary.tasks.reduce((n,t)=>{duration(t.durationMs);return n+t.durationMs;},0)<=end-graph);
    Object.assign(result,{status:'PASS',summarySha256:digest(summaryBytes),legacyReceiptSha256:digest(legacyBytes),tasks:coverage.tasks,preparationDurationMs:graph-preparationStartedAt,graphDurationMs:end-graph});
  }catch{/* Old reports and mutable/partial execution never qualify a fresh companion. */}
  return result;
}
export function validateFullCompanion(result, legacy, legacyBytes, value, run, attempt) {
  assert.deepEqual(Object.keys(result).sort(),Object.keys(fullCompanion(null,null,value,{run,attempt})).sort());
  for(const [key,expected]of Object.entries({schemaVersion:1,kind:'reader-change-full-execution',run,attempt,policy:'reader-hear-source-execution-v1',scope:'reader',profile:'full',selectionApplied:false,contractSha256:READER_CONTRACT,status:'PASS',summarySha256:legacy.summarySha256,legacyReceiptSha256:digest(legacyBytes)}))assert.equal(result[key],expected);
  assert.deepEqual(result.binding,binding(value));assert.deepEqual(result.tasks,TASKS.map(id=>({id,status:'PASS'})));duration(result.preparationDurationMs);duration(result.graphDurationMs);
}

export function aggregate(bytes, value, run, attempt, id, outcomes, manifest = MANIFEST) {
  const result = {schemaVersion:1,kind:'reader-hear-real-change-qualification',binding:binding(value),run:positive(run),attempt:positive(attempt),example:id,policy:'reader-hear-shadow-v2',selectionApplied:false,manifestSha256:digest(JSON.stringify(manifest)),hearAdapter:manifest.hearAdapter,status:'FAIL',planSha256:null,changesSha256:null,products:[],selectedTasks:[],executedTasks:ALL_TASKS.map(id=>({id,status:'NOT_RUN',durationMs:null})),receipts:{},acceptance:{sourceExecution:'NOT_RUN',cpuCompilation:'NOT_RUN',nativeCompilation:'NOT_RUN',scriptedGui:'NOT_RUN',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'}};
  try {
    assert.deepEqual(outcomes,{plan:'success',full:'success',cpu:'success',hear:'success'});
    assert.deepEqual(Object.keys(bytes).sort(),['plan','full','fullExecution','legacy','catalog','hear'].sort());
    for (const key of ['plan','full','fullExecution','legacy','catalog','hear']) assert(Buffer.isBuffer(bytes[key]) && bytes[key].length <= 65536);
    const records=Object.fromEntries(Object.entries(bytes).map(([key,bytes])=>[key,JSON.parse(bytes)]));
    const plan=validateExamplePlan(records.plan,value,run,attempt,id,manifest);
    validateResult(records.full,value);assert.equal(records.full.status,'PASS');
    validateFullCompanion(records.fullExecution,records.full,bytes.full,value,run,attempt);
    validateCpuResult(records.legacy,value,{run,attempt,mode:'llama-cpu'});assert.equal(records.legacy.status,'PASS');
    const cpu=records.catalog;
    assert.deepEqual(Object.keys(cpu).sort(),Object.keys(catalogResult(null,null,null,null,value,{run,attempt,execution:'failure'})).sort());
    for (const [key,expected]of Object.entries({schemaVersion:2,kind:'reader-shared-cpu-catalog-verification',run,attempt,policy:'reader-hear-source-execution-v1',scope:'llama-cpu',profile:'full',selectionApplied:false,catalogContractSha256:CATALOG_CONTRACT,legacyContractSha256:CPU_CONTRACT,executorPolicy:EXECUTOR_POLICY,executorContractSha256:EXECUTOR_CONTRACT,status:'PASS',summarySha256:records.legacy.summarySha256,legacyReceiptSha256:digest(bytes.legacy)}))assert.equal(cpu[key],expected);
    assert.deepEqual(cpu.binding,binding(value));assert.deepEqual(cpu.tasks,CPU_TASKS.map(({id})=>({id,status:'PASS'})));
    assert.deepEqual(cpu.acceptance,{cpuCompilation:'PASS',hearNativeCompilation:'NOT_RUN',scriptedGui:'NOT_RUN',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'});
    validateHear(records.hear,value,run,attempt);
    const actual=[...records.full.tasks,...records.hear.tasks,...records.legacy.tasks];assert.deepEqual(actual.map(t=>t.id),ALL_TASKS);
    for (const task of actual) { assert.equal(task.status,'PASS');duration(task.durationMs); }
    const selected=selectedIds(id).map(id=>actual.find(task=>task.id===id));assert(selected.every(Boolean));
    Object.assign(result,{status:'PASS',planSha256:plan.planSha256,changesSha256:plan.changesSha256,products:plan.products,selectedTasks:selected,executedTasks:actual,receipts:Object.fromEntries(Object.entries(bytes).map(([key,bytes])=>[key,digest(bytes)])),acceptance:{...result.acceptance,sourceExecution:'PASS',cpuCompilation:'PASS',nativeCompilation:'PASS',scriptedGui:'PASS'}});
  } catch { /* No partial or cross-source result can supply execution qualification. */ }
  return result;
}
function ordinary(file, maximum) { const info=lstatSync(file);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=maximum);assert.equal(realpathSync(file),resolve(file));return readFileSync(file); }
function current() { assert.equal(process.env.GITHUB_REPOSITORY,'lwtlab/reader');assert.equal(process.env.GITHUB_REF,`refs/heads/${MANIFEST.publicBranch}`); const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));assert.equal(value.workflow,process.env.GITHUB_SHA);const id=process.env.CHANGE_EXAMPLE;exampleFor(id);return {value,id,run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT)}; }
function planBytes() {return ordinary('source/.artifacts/verification-plan/plan.json',2*1024*1024);}
function freshPlan(value,run,attempt,id) {
  let bytes=null;try{verifyImplementation(resolve('source'));bytes=planBytes();}catch{}
  const result=planResult(bytes,value,run,attempt,{controls:process.env.SHADOW_CONTROLS_OUTCOME,plan:process.env.SHADOW_PLAN_OUTCOME});
  if(result.status==='PASS')try{validateExamplePlan(result,value,run,attempt,id);}catch{result.status='FAIL';result.validation='FAIL';}
  return {bytes,result};
}
async function main() {
  const mode=process.argv[2];assert.equal(process.argv.length,3);
  if(mode==='resolve') {
    assert.equal(process.env.GITHUB_REPOSITORY,'lwtlab/reader');assert.equal(process.env.GITHUB_REF,`refs/heads/${MANIFEST.publicBranch}`);assert.equal(process.env.WORKFLOW_SHA,process.env.GITHUB_SHA);
    const example=exampleFor(process.env.CHANGE_EXAMPLE);assert.equal(process.env.SOURCE_REF,example.head);assert.equal(Number(process.env.PR_NUMBER),example.pr);
    const value=await resolveExample(github(process.env.GH_TOKEN),process.env.CHANGE_EXAMPLE,process.env.GITHUB_SHA);
    appendFileSync(process.env.GITHUB_OUTPUT,`binding=${JSON.stringify(value)}\ntested=${value.tested}\nhead=${value.head}\nbase=${value.base}\npr=${value.pr}\n`);console.log('Reviewed real change input and actual merge parents verified');return;
  }
  const {value,id,run,attempt}=current();
  if(mode==='plan-identity') {
    verifyImplementation(resolve('source'));
    const git=args=>execFileSync('git',args,{cwd:'source',encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')))}).trim();
    assert.equal(git(['rev-parse','HEAD']),value.tested);assert.equal(git(['status','--porcelain']),'');assert.equal(git(['show','-s','--format=%P','HEAD']),`${value.base} ${value.head}`);
    appendFileSync(process.env.GITHUB_ENV,`VERIFICATION_PLAN_IDENTITY=${JSON.stringify(planIdentity(value,run,attempt))}\n`);return;
  }
  if(['full-collect','full-require'].includes(mode)) {
    let summaryBytes=null,legacyBytes=null;
    try {
      verifyImplementation(resolve('source'));
      const git=args=>execFileSync('git',args,{cwd:'source',encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')))}).trim();
      assert.equal(git(['rev-parse','HEAD']),value.tested);assert.equal(git(['status','--porcelain']),'');
      const folder='source/.artifacts/verify',names=readdirSync(folder);assert.equal(names.length,1);assert.match(names[0],/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      summaryBytes=ordinary(join(folder,names[0],'summary.json'),5*1024*1024);legacyBytes=ordinary('verification-output/verification.json',65536);
    }catch{}
    const result=fullCompanion(summaryBytes,legacyBytes,value,{run,attempt,execution:process.env.EXAMPLE_FULL_OUTCOME,preparationStartedAt:Number(process.env.READER_PREPARATION_STARTED_MS)});
    const file='verification-output/full-execution.json';
    if(mode==='full-collect'){mkdirSync('verification-output',{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify(result,null,2),{mode:0o600});}
    else{assert.deepEqual(JSON.parse(ordinary(file,65536)),result);assert.equal(result.status,'PASS');}
    return;
  }
  if(['plan-collect','plan-require'].includes(mode)) {
    const {bytes,result}=freshPlan(value,run,attempt,id), folder='change-plan-output';
    if(mode==='plan-collect') {
      assert(!existsSync(folder));mkdirSync(folder,{mode:0o700});
      writeFileSync(join(folder,'verification.json'),JSON.stringify(result,null,2),{mode:0o600});
      const key=readFileSync(new URL('./build-logs-public.pem',import.meta.url));
      if(bytes)writeFileSync(join(folder,'plan.enc.json'),JSON.stringify(encryptLog(bytes,key)),{mode:0o600});
      const log=join(process.env.RUNNER_TEMP,'reader-private-build.log');
      if(existsSync(log))writeFileSync(join(folder,'controls-log.enc.json'),JSON.stringify(encryptLog(ordinary(log,8*1024*1024),key)),{mode:0o600});
    }else{assert.deepEqual(JSON.parse(ordinary(join(folder,'verification.json'),65536)),result);assert.equal(result.status,'PASS');}
    return;
  }
  assert.equal(mode,'aggregate');
  const inputs={};for(const [key,file]of Object.entries({plan:'plan/verification.json',full:'full/verification.json',fullExecution:'full/full-execution.json',legacy:'cpu/verification.json',catalog:'cpu/catalog.json',hear:'hear/verification.json'}))try{inputs[key]=ordinary(join('change-inputs',file),65536);}catch{}
  const result=aggregate(inputs,value,run,attempt,id,JSON.parse(process.env.CHANGE_OUTCOMES));
  mkdirSync('change-result',{mode:0o700});writeFileSync('change-result/qualification.json',JSON.stringify(result,null,2),{mode:0o600});
  console.log(`Real change qualification: ${result.status}; ${result.executedTasks.filter(t=>t.status==='PASS').length}/49 executed tasks`);assert.equal(result.status,'PASS');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Real change qualification rejected; inspect authenticated diagnostics');process.exitCode=1;});
