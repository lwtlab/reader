// Explicit selected execution only. Default full/CPU reporters and pins are untouched.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {binding,digest,positive,fingerprint,verifyMergeParents,TASKS} from './reader-verification.mjs';
import {github} from './reader-verification-control.mjs';
import {verifyImplementation,planIdentity} from './shadow-plan.mjs';
import {encryptLog} from './log-crypto.mjs';
import {POLICY,CONTEXT,IMPLEMENTATION,planFromBytes,validatePlan,readerFromBytes,validateReader,coreFromBytes,cpuFromRecords,aggregate} from './selected-contract.mjs';
import {reportSelected} from './selected-report.mjs';
import {MANIFEST,exampleFor,resolveSelected,checkExamplePlan} from './selected-input.mjs';
function ordinary(file,limit=5*1024*1024){const s=lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=limit);assert.equal(realpathSync(file),resolve(file));return readFileSync(file);}
function json(file,limit){return JSON.parse(ordinary(file,limit));}
function write(file,value){mkdirSync(join(file,'..'),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function current(){assert.equal(process.env.GITHUB_REPOSITORY,'lwtlab/reader');assert.equal(process.env.GITHUB_REF,`refs/heads/${MANIFEST.publicBranch}`);const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));assert.equal(value.workflow,process.env.GITHUB_SHA);const id=process.env.SELECTION_CASE,example=exampleFor(id);assert.equal(value.head,example.head);assert.equal(value.base,example.base);assert.equal(value.pr,example.pr);assert(['','true','false',undefined].includes(process.env.SELECTION_PROBE));return {value,id,run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT),probe:process.env.SELECTION_PROBE==='true'};}
function sourceRoot(){assert([undefined,'source','core'].includes(process.env.SELECTION_SOURCE_DIR));return resolve(process.env.SELECTION_SOURCE_DIR??'source');}
function identitySource(value){const source=sourceRoot();verifyImplementation(source,IMPLEMENTATION.implementation);const git=(...args)=>execFileSync('git',args,{cwd:source,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),encoding:'utf8'}).trim();assert.equal(git('rev-parse','HEAD'),value.tested);assert.equal(git('status','--porcelain'),'');assert.equal(git('show','-s','--format=%P','HEAD'),`${value.base} ${value.head}`);return source;}
function privatePlan(source){return ordinary(join(source,'.artifacts/verification-selected/plan.json'));}
function fresh({value,id,run,attempt},outcomes={controls:'success',plan:'success'}){const source=identitySource(value),bytes=privatePlan(source),record=planFromBytes(bytes,value,run,attempt,outcomes);checkExamplePlan(record,id);return {source,bytes,record};}
function master(info){const record=json('selected-inputs/plan/plan.json',65536);validatePlan(record,info.value,info.run,info.attempt);checkExamplePlan(record,info.id);const local=fresh(info);assert.deepEqual(local.record.selection,record.selection);return {...local,record};}
function seal(file,name){if(!existsSync(file))return;const bytes=ordinary(file,32*1024*1024),out=join('selected-output',name+'.enc.json');if(!existsSync(out))writeFileSync(out,JSON.stringify(encryptLog(bytes,readFileSync(new URL('./build-logs-public.pem',import.meta.url)))),{flag:'wx',mode:0o600});}
function oneSummary(source){const folder=join(source,'.artifacts/verify'),rows=readdirSync(folder);assert.equal(rows.length,1);assert(/^[a-f0-9-]{36}$/.test(rows[0]));return ordinary(join(folder,rows[0],'summary.json'));}
function recordSet(info){
 const planBytes=ordinary('selected-inputs/plan/plan.json',65536),plan=JSON.parse(planBytes);validatePlan(plan,info.value,info.run,info.attempt);checkExamplePlan(plan,info.id);const profile=plan.selection.lanes[0].profile,hear=plan.selection.lanes[2].tasks.length>0,core=plan.selection.lanes[1].coreTasks.length>0;
 const bytes={plan:planBytes,reader:ordinary('selected-inputs/reader/selection.json',65536),cpu:ordinary('selected-inputs/cpu/verification.json',65536),catalog:ordinary('selected-inputs/cpu/catalog.json',65536),core:core?ordinary('selected-inputs/cpu/core.json',65536):null,hear:hear?ordinary('selected-inputs/hear/verification.json',65536):null,legacy:profile==='full'?ordinary('selected-inputs/reader/verification.json',65536):null};
 if(!hear)assert(!existsSync('selected-inputs/hear/verification.json'));if(!core)assert(!existsSync('selected-inputs/cpu/core.json'));if(profile!=='full')assert(!existsSync('selected-inputs/reader/verification.json'));
 const records=Object.fromEntries(Object.entries(bytes).filter(([key])=>key!=='plan').map(([key,b])=>[key,key==='legacy'?b:b?JSON.parse(b):null]));return {plan,bytes,records};
}
async function main(){
 assert.equal(process.argv.length,3);const mode=process.argv[2];
 if(mode==='resolve'){
  assert.equal(process.env.GITHUB_REPOSITORY,'lwtlab/reader');assert.equal(process.env.GITHUB_REF,`refs/heads/${MANIFEST.publicBranch}`);assert.equal(process.env.WORKFLOW_SHA,process.env.GITHUB_SHA);const id=process.env.SELECTION_CASE,example=exampleFor(id);assert.equal(process.env.SOURCE_REF,example.head);assert.equal(Number(process.env.PR_NUMBER),example.pr);const api=github(process.env.GH_TOKEN),value=await resolveSelected(api,id,process.env.GITHUB_SHA);const run=positive(process.env.GITHUB_RUN_ID),attempt=positive(process.env.GITHUB_RUN_ATTEMPT),probe=process.env.SELECTION_PROBE==='true';
  if(probe)assert.equal(id,'reader-only','Only the Reader-only CPU/core probe is supported');
  if(!probe)await api(`repos/lwtlab/lwt-core/statuses/${value.head}`,'POST',{state:'pending',context:CONTEXT,description:`selected pending ${fingerprint(value)}`,target_url:`https://github.com/lwtlab/reader/actions/runs/${run}/attempts/${attempt}`});
  appendFileSync(process.env.GITHUB_OUTPUT,`binding=${JSON.stringify(value)}\ntested=${value.tested}\nhead=${value.head}\nbase=${value.base}\npr=${value.pr}\n`);console.log('Reviewed selected-source input and actual merge parents verified');return;
 }
 const info=current(),{value,id,run,attempt,probe}=info;mkdirSync('selected-output',{recursive:true,mode:0o700});
 if(mode==='identity'){identitySource(value);appendFileSync(process.env.GITHUB_ENV,`VERIFICATION_SELECTION_IDENTITY=${JSON.stringify(planIdentity(value,run,attempt))}\n`);return;}
 if(mode==='plan-collect'){
  const {bytes,record}=fresh(info,{controls:process.env.SELECTION_CONTROLS_OUTCOME,plan:process.env.SELECTION_PLAN_OUTCOME});write('selected-output/plan.json',record);writeFileSync('selected-output/plan.enc.json',JSON.stringify(encryptLog(bytes,readFileSync(new URL('./build-logs-public.pem',import.meta.url)))),{flag:'wx',mode:0o600});
  appendFileSync(process.env.GITHUB_OUTPUT,`reader_profile=${record.selection.lanes[0].profile}\nhear_required=${record.selection.lanes[2].tasks.length>0}\ncore_required=${record.selection.lanes[1].coreTasks.length>0}\nplan_sha=${record.selection.planSha256}\n`);console.log('Selected plan verified; task outcomes remain NOT_RUN');return;
 }
 if(mode==='plan-require'){validatePlan(json('selected-output/plan.json'),value,run,attempt);return;}
 if(mode==='reader-collect'){
  const {source,record}=master(info),bytes=oneSummary(source),legacy=record.selection.readerFullRequired?ordinary('verification-output/verification.json',65536):null;const result=readerFromBytes(bytes,legacy,record,value,{run,attempt,execution:process.env.SELECTED_READER_OUTCOME,preparationStartedAt:Number(process.env.READER_PREPARATION_STARTED_MS)});write('selected-output/selection.json',result);seal(join(source,'.artifacts/verification-selected/plan.json'),'local-plan');writeFileSync('selected-output/reader-summary.enc.json',JSON.stringify(encryptLog(bytes,readFileSync(new URL('./build-logs-public.pem',import.meta.url)))),{flag:'wx',mode:0o600});if(legacy)writeFileSync('selected-output/verification.json',legacy,{flag:'wx',mode:0o600});console.log(`Selected Reader ${result.profile}: ${result.tasks.length} source tasks verified`);return;
 }
 if(mode==='reader-require'){const {record}=master(info);const legacy=record.selection.readerFullRequired?ordinary('selected-output/verification.json',65536):null;validateReader(json('selected-output/selection.json'),legacy,record,value,run,attempt);return;}
 if(mode==='core-collect'){
  const {source,record}=master(info),bytes=ordinary(join(source,'.artifacts/verification-selected/core.json'));const log=ordinary(join(process.env.RUNNER_TEMP,'reader-private-build.log'),32*1024*1024).toString();const matches=[...log.matchAll(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored/g)];assert.equal(matches.length,1);const rust={passed:Number(matches[0][1]),ignored:Number(matches[0][2])};const result=coreFromBytes(bytes,record,value,{run,attempt,execution:process.env.SELECTED_CORE_OUTCOME},rust);write('llama-cpu-output/core.json',result);seal(join(source,'.artifacts/verification-selected/core.json'),'core-summary');console.log('Selected core prerequisites verified');return;
 }
 if(mode==='cpu-require'){
  const {record}=master(info),cpuBytes=ordinary('llama-cpu-output/verification.json',65536),catalogBytes=ordinary('llama-cpu-output/catalog.json',65536),legacy=JSON.parse(cpuBytes),catalog=JSON.parse(catalogBytes),core=record.selection.lanes[1].coreTasks.length?json('llama-cpu-output/core.json',65536):null;cpuFromRecords(legacy,catalog,core,record,value,run,attempt,{cpu:cpuBytes,catalog:catalogBytes});return;
 }
 if(mode==='seal'){
  const source=sourceRoot();seal(join(source,'.artifacts/verification-selected/plan.json'),'local-plan');seal(join(source,'.artifacts/verification-selected/core.json'),'core-summary');const folder=join(source,'.artifacts/verify');if(existsSync(folder)){for(const name of readdirSync(folder))if(/^[a-f0-9-]{36}$/.test(name))seal(join(folder,name,'summary.json'),'reader-summary');}seal(join(process.env.RUNNER_TEMP,'reader-private-build.log'),'selected-log');return;
 }
 if(mode==='aggregate'){
  let result;try{const {plan,bytes,records}=recordSet(info),outcomes=JSON.parse(process.env.SELECTION_OUTCOMES);assert(!probe);result=aggregate(records,plan,value,run,attempt,outcomes,bytes);}catch{result={schemaVersion:1,kind:'reader-hear-selected-execution',binding:value,run,attempt,policy:POLICY,selectionApplied:true,status:'FAIL',execution:JSON.parse(process.env.SELECTION_OUTCOMES??'{}'),reason:'No complete current-run validated coverage'};}
  write('selected-output/qualification.json',result);assert.equal(result.status,'PASS','Selected source verification failed');console.log(`Selected source coverage PASS; ${result.tasks.filter(t=>t.status==='PASS').length} tasks`);return;
 }
 if(mode==='probe'){
  assert(probe);const plan=json('selected-inputs/plan/plan.json',65536);validatePlan(plan,value,run,attempt);const cpuBytes=ordinary('selected-inputs/cpu/verification.json',65536),catalogBytes=ordinary('selected-inputs/cpu/catalog.json',65536),cpu=JSON.parse(cpuBytes),catalog=JSON.parse(catalogBytes),core=plan.selection.lanes[1].coreTasks.length?json('selected-inputs/cpu/core.json',65536):null;cpuFromRecords(cpu,catalog,core,plan,value,run,attempt,{cpu:cpuBytes,catalog:catalogBytes});const result={schemaVersion:1,kind:'reader-hear-selected-component-probe',binding:value,run,attempt,policy:POLICY,status:'NOT_QUALIFIED',selectionApplied:true,planSha256:plan.selection.planSha256,readerFull:'NOT_RUN',contextWritten:false,acceptance:{sourceExecution:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'},cpu:'PASS',core:core?'PASS':'NOT_RUN'};write('selected-output/probe.json',result);console.log('Focused component diagnostics complete; no selected gate receipt was produced');return;
 }
 if(mode==='report'){
  assert(!probe);await reportSelected(github(process.env.GH_TOKEN),value,{run,attempt,id,manifest:MANIFEST,token:process.env.GH_TOKEN});return;
 }
 assert.fail('Unknown selected operation');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Selected verification failed; inspect encrypted diagnostics. No private output is printed.');process.exitCode=1;});
