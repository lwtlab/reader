import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { digest } from './reader-verification.mjs';
import { CPU_TASKS, CPU_CONTRACT, cpuResult } from './llama-cpu-verification.mjs';
import { executeTasks, executeOwnedCpu } from './llama-cpu-run.mjs';
import { CATALOG_POLICY, CATALOG_CONTRACT, validateCpuPlan, readCpuPlan, cpuCoverage, catalogResult, validateCpuExecution, loadCpuExecutor, EXECUTOR_POLICY, EXECUTOR_PINS } from './cpu-catalog.mjs';

function fixturePlan() {
  const tasks=structuredClone(CPU_TASKS).map((task,index)=>({...task,cwd:'.',dependencies:index?[CPU_TASKS[index-1].id]:[],profile:'full',products:['reader','hear'],platforms:['linux'],evidence:task.id==='cpu-build'?'native-compilation':task.id==='gguf-tooling'?'prerequisite':'source-check'}));
  const definition={policy:CATALOG_POLICY,scope:'llama-cpu',profile:'full',selectionApplied:false,executionPlatforms:['linux'],tasks};
  return {...definition,contractSha256:digest(JSON.stringify(definition))};
}
const value={head:'a'.repeat(40),base:'b'.repeat(40),tested:'c'.repeat(40),pr:274,workflow:'d'.repeat(40)};
const options={run:123,attempt:1,mode:'llama-cpu',execution:'success',build:{upstreamRevision:'e'.repeat(40),manifestSha256:'f'.repeat(64),runtimeSha256:'0'.repeat(64),bundleSha256:'1'.repeat(64),fileCount:1},diagnostics:'2'.repeat(64)};
function state(status='PASS') {
  const before={head:value.tested,dirty:false,upstreamRevision:options.build.upstreamRevision};
  const tasks=CPU_TASKS.map(({id})=>({id,status,exitCode:status==='PASS'?0:null,durationMs:status==='PASS'?5:null}));
  const plan=fixturePlan();
  const cpuExecutor={policy:EXECUTOR_POLICY,platform:'linux',catalogExecution:cpuCoverage(plan,tasks),tasks,commands:status==='PASS'?plan.tasks.flatMap(task=>task.commands.map((_,commandIndex)=>({taskId:task.id,commandIndex,exitCode:0,signal:null,resources:{samples:1,detachedProcessesCleaned:0}}))):[]};
  return {cpuExecutor,executionRunId:'11111111-1111-4111-8111-111111111111',binding:structuredClone(value),run:123,attempt:1,scope:'llama-cpu',contract:CPU_CONTRACT,sourceBefore:before,sourceAfter:structuredClone(before),tasks,catalogPlan:plan,catalogExecution:cpuCoverage(plan,tasks)};
}
function result(summary,overrides={}) {
  const bytes=Buffer.from(JSON.stringify(summary)),opts={...options,...overrides,bytes};
  const legacy=cpuResult(summary,value,opts),legacyBytes=Buffer.from(JSON.stringify(legacy)+'\n');
  return catalogResult(summary,legacy,bytes,legacyBytes,value,opts);
}
test('shared CPU plan independently matches all nine original stages and strict Linux contract',()=>{
  const plan=fixturePlan();assert.equal(plan.contractSha256,CATALOG_CONTRACT);validateCpuPlan(plan);
  assert.deepEqual(plan.tasks.map(({id,commands})=>({id,commands})),CPU_TASKS);assert.equal(CPU_CONTRACT,'63bb538e2077bdd6ad3759b06cd4a16e10264bc592de894c7cba70b83b8b8011');
  for(const change of [p=>p.tasks.pop(),p=>p.tasks[0].commands.pop(),p=>p.tasks[1].dependencies=[],p=>p.tasks[0].env={PRIVATE:'x'},p=>p.executionPlatforms.push('darwin'),p=>p.selectionApplied=true,p=>p.scope='reader']){const p=fixturePlan();change(p);assert.throws(()=>validateCpuPlan(p));}
});
test('legacy CPU adapter preserves supplied catalog groups and preserves failure dependencies',async()=>{
  const plan=fixturePlan(),commands=plan.tasks.flatMap(task=>task.commands);
  for(const failIndex of [-1,0,1,5,6]) {
    const summary=state('NOT_RUN'),called=[];
    const passed=await executeTasks(summary,'unused',()=>{}, {catalogPlan:plan,execute:async command=>{called.push(command);return {code:called.length-1===failIndex?9:0};}});
    assert.deepEqual(called,failIndex<0?commands:commands.slice(0,failIndex+1));assert.equal(passed,failIndex<0);
    if(failIndex<0)assert.equal(summary.catalogExecution.status,'PASS');else{assert.equal(summary.catalogExecution.status,'FAIL');const failed=summary.tasks.findIndex(task=>task.status==='FAIL');assert(failed>=0);assert(summary.tasks.slice(failed+1).every(task=>task.status==='NOT_RUN'));}
  }
  const changed=fixturePlan();changed.tasks[0].commands[0]=['node','unapproved'];
  await assert.rejects(executeTasks(state('NOT_RUN'),'unused',()=>{},{catalogPlan:changed,execute:()=>assert.fail('Unapproved command ran')}));
});
test('coverage rejects stale, missing, duplicated and dependency-invalid PASS results',()=>{
  const plan=fixturePlan();assert.equal(cpuCoverage(plan,state('NOT_RUN').tasks).status,'INCOMPLETE');
  for(const change of [s=>s.tasks.pop(),s=>s.tasks.push(s.tasks[0]),s=>s.tasks[0].status='REUSED',s=>s.tasks[0].exitCode=1,s=>s.tasks[0].durationMs=null,s=>s.tasks[0].status='NOT_RUN']){const s=state();change(s);assert.throws(()=>cpuCoverage(plan,s.tasks));}
});
test('CPU catalog receipt binds exact source/run/plan/legacy bytes without exposing private output',()=>{
  const s=state();s.private='SYNTHETIC_PRIVATE_TEXT';s.tasks[0].error='SYNTHETIC_PRIVATE_ERROR';const actual=result(s);assert.equal(actual.status,'PASS');assert.equal(actual.acceptance.cpuCompilation,'PASS');assert.equal(actual.acceptance.modelInference,'NOT_RUN');assert(actual.tasks.every(task=>task.status==='PASS'));assert.doesNotMatch(JSON.stringify(actual),/SYNTHETIC_PRIVATE|commands|cwd/);
  for(const change of [s=>s.run++,s=>s.attempt++,s=>s.scope='full',s=>s.binding.head='f'.repeat(40),s=>s.sourceBefore.dirty=true,s=>s.sourceAfter.head='f'.repeat(40),s=>s.executionRunId='old',s=>s.catalogPlan.tasks.pop(),s=>s.catalogExecution.status='INCOMPLETE',s=>s.tasks[0].status='REUSED',s=>delete s.cpuExecutor,s=>s.cpuExecutor.policy='old',s=>s.cpuExecutor.commands.pop(),s=>s.cpuExecutor.commands[0].resources=null]) {
    const s=state();change(s);const bad=result(s);assert.equal(bad.status,'FAIL');assert.equal(bad.summarySha256,null);assert(bad.tasks.every(task=>task.status==='NOT_RUN'));
  }
  for(const execution of ['failure','cancelled','skipped',undefined])assert.equal(result(state(),{execution}).status,'FAIL');
});
test('real readonly private-plan CLI output is validated before commands can execute',t=>{
  const source=mkdtempSync(path.join(tmpdir(),'cpu-catalog-plan-'));t.after(()=>rmSync(source,{recursive:true,force:true}));mkdirSync(path.join(source,'scripts'));
  const file=path.join(source,'scripts/verification-execution.mjs');writeFileSync(file,`console.log(${JSON.stringify(JSON.stringify(fixturePlan()))})\n`);
  assert.deepEqual(readCpuPlan(source),fixturePlan());
  const changed=fixturePlan();changed.tasks[0].commands[0]=['node','unapproved'];writeFileSync(file,`console.log(${JSON.stringify(JSON.stringify(changed))})\n`);assert.throws(()=>readCpuPlan(source));
  writeFileSync(file,"console.log('invalid plan')\n");assert.throws(()=>readCpuPlan(source));
});
test('optional CPU catalog scope keeps credentials, uploads and status contexts isolated',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8'),job=yaml.slice(yaml.indexOf('\n  catalog-cpu:'));
  assert.match(job,/if: inputs.scope == 'catalog-cpu'/);assert.match(job,/CPU_CATALOG: 'true'/);assert.match(job,/VERIFICATION_SCOPE: llama-cpu/);assert.match(job,/VERIFICATION_OUTCOME: \$\{\{ steps.cpu.outcome \}\}/);
  assert.doesNotMatch(job,/READER_VERIFICATION_TOKEN|SIGNING|continue-on-error|pull_request_target|actions\/cache/);
  assert.match(job,/reader-catalog-cpu-result-/);assert.match(job,/reader-catalog-cpu-encrypted-/);assert.match(job,/llama-cpu-output\/catalog.json/);assert.doesNotMatch(job,/path:.*private-summary|path:.*source\//);
  assert.match(job,/node ci\/llama-cpu-run.mjs require-catalog/);
  const controller=readFileSync(new URL('./reader-verification-control.mjs',import.meta.url),'utf8');assert(controller.indexOf("if(mode==='shadow-plan'||mode==='catalog-cpu')")<controller.indexOf("if(mode==='full')await postStatus"));
  assert.match(yaml,/llama-cpu:\n    if: inputs.scope != 'shadow-plan' && inputs.scope != 'catalog-cpu'/);
});
test('actual catalog final gate rejects missing mode even with an otherwise valid legacy receipt',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'cpu-catalog-required-mode-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(path.join(root,'llama-cpu-output'));
  const summary=state(),bytes=Buffer.from(JSON.stringify(summary));writeFileSync(path.join(root,'llama-cpu-output/verification.json'),JSON.stringify(cpuResult(summary,value,{...options,bytes})));
  const env={...process.env,VERIFICATION_BINDING:JSON.stringify(value),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',VERIFICATION_SCOPE:'llama-cpu',RUNNER_TEMP:root};delete env.CPU_CATALOG;
  const cli=fileURLToPath(new URL('./llama-cpu-run.mjs',import.meta.url));
  assert.equal(spawnSync(process.execPath,[cli,'require'],{cwd:root,env}).status,0);
  assert.equal(spawnSync(process.execPath,[cli,'require-catalog'],{cwd:root,env}).status,1);
});

test('owned CPU adapter consumes shared executor results and persists all coverage',async()=>{
 for(const fail of [false,true]){
  const s=state('NOT_RUN'),saved=[],signal=new AbortController().signal,output=()=>{};
  const returned=await executeOwnedCpu(s,'owned-source',output,{signal,persist:summary=>saved.push(structuredClone(summary)),load:async source=>{
   assert.equal(source,'owned-source');return async context=>{
    assert.equal(context.root,source);assert.equal(context.signal,signal);assert.equal(context.output,output);assert.deepEqual(context.contract,fixturePlan());assert.equal(context.env.PYTHONDONTWRITEBYTECODE,'1');
    const complete=state();if(fail){complete.tasks.forEach((task,index)=>Object.assign(task,{status:index?'NOT_RUN':'FAIL',exitCode:index?null:1,durationMs:index?null:5}));complete.cpuExecutor.commands=complete.cpuExecutor.commands.slice(0,1);complete.cpuExecutor.commands[0].exitCode=1;complete.cpuExecutor.catalogExecution=cpuCoverage(complete.catalogPlan,complete.tasks);}
    for(const task of complete.tasks)context.onResult(task);
    return complete.cpuExecutor;
   };
  }});
  assert.equal(returned,!fail);assert.equal(saved.length,10);assert.deepEqual(s.cpuExecutor.tasks,s.tasks);assert.equal(s.cpuExecutor.catalogExecution.status,fail?'FAIL':'PASS');
 }
 const summary=state('NOT_RUN');await assert.rejects(executeOwnedCpu(summary,'unused',()=>{},{load:async()=>()=>({...state().cpuExecutor,policy:'old'})}));
});
test('owned CPU proof rejects old adapters, partial command coverage and wrong platform',()=>{
 for(const change of [r=>r.policy='old',r=>r.platform='darwin',r=>r.commands.pop(),r=>r.commands.push(r.commands[0]),r=>r.commands.reverse(),r=>r.commands[1].commandIndex=0,r=>r.commands[0].exitCode=1,r=>r.commands[0].signal='SIGTERM',r=>r.commands[0].resources=null,r=>r.catalogExecution.status='INCOMPLETE']){
  const summary=state(),report=structuredClone(summary.cpuExecutor);change(report);assert.throws(()=>validateCpuExecution(report,summary.catalogPlan,summary.tasks));
 }
});
test('private executable imports are hash-checked before evaluation',async t=>{
 const root=mkdtempSync(path.join(tmpdir(),'cpu-executor-pin-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(path.join(root,'scripts'));
 assert.equal(Object.keys(EXECUTOR_PINS).length,6);
 const marker=path.join(root,'unexpected-import');writeFileSync(path.join(root,'scripts/verification-cpu-execution.mjs'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');export const cpuExecutorPolicy=${JSON.stringify(EXECUTOR_POLICY)};export function executeCpuPlan(){}`);
 await assert.rejects(loadCpuExecutor(root));assert.throws(()=>readFileSync(marker));
});
