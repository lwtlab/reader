// The shared private plan drives commands. The original public nine-stage
// contract remains an independent validator and never borrows Reader full PASS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { binding, digest, positive } from './reader-verification.mjs';
import { CPU_TASKS, CPU_CONTRACT, cpuResult, validateCpuResult } from './llama-cpu-verification.mjs';

export const CATALOG_POLICY = 'reader-hear-source-execution-v1';
export const CATALOG_CONTRACT = '52dd2b12c7dc15c6520e491db000650cca34de2779c238342edc967b8d1031d7';
export const EXECUTOR_POLICY = 'shared-owned-cpu-execution-v1';
// Pin the complete local module graph before importing private executable code.
export const EXECUTOR_PINS = {
  "scripts/verification-cpu-execution.mjs": "45549129e04282e85bc38ec7268b116132599341bff7483d2c817270471c9d1b",
  "scripts/verification-execution.mjs": "c9ff6cf3fb37bffd87eb68d9cff054a916d676b959d017248b0899a95610e78c",
  "scripts/verification-catalog.mjs": "d76f0617729d80ed40c4707c7d4d41f26ef27370d8c813ddd00db967b0e9e49a",
  "scripts/verification-cpu-tasks.mjs": "a5ed5d7c5601b9af72d17d1b45a16a5f4f8ca21016622743687c15362517b958",
  "scripts/verify-tasks.mjs": "ed75ec8b8c609597c16f6dcbcc7ee622211e5e3f7d31869fc70e6663295b39b3",
  "scripts/verify-runtime.mjs": "d9bab01d1d42c6bef7e6305a7beb40c62cc4e011174eb3354204fe8dc9367417"
};
export const EXECUTOR_CONTRACT = digest(JSON.stringify(EXECUTOR_PINS));
export function verifyCpuExecutorGraph(source) {
  assert.equal(Object.keys(EXECUTOR_PINS).length,6);
  for(const [file,hash] of Object.entries(EXECUTOR_PINS)) {
    const candidate=path.join(realpathSync(source),file);
    assert(lstatSync(candidate).isFile()&&!lstatSync(candidate).isSymbolicLink());assert.equal(realpathSync(candidate),candidate);
    assert.equal(digest(readFileSync(candidate)),hash,'Changed shared CPU executor');
  }
}
export async function loadCpuExecutor(source) {
  verifyCpuExecutorGraph(source);
  const module=await import(pathToFileURL(path.join(source,'scripts/verification-cpu-execution.mjs')).href);
  assert.equal(module.cpuExecutorPolicy,EXECUTOR_POLICY);assert.equal(typeof module.executeCpuPlan,'function');
  return module.executeCpuPlan;
}
export function validateCpuExecution(report,plan,tasks) {
  validateCpuPlan(plan);
  assert.deepEqual(Object.keys(report).sort(),['policy','platform','catalogExecution','tasks','commands'].sort());
  assert.equal(report.policy,EXECUTOR_POLICY);assert.equal(report.platform,'linux');assert.deepEqual(report.tasks,tasks);
  assert.deepEqual(report.catalogExecution,cpuCoverage(plan,tasks));
  const expected=[];
  for(const [index,task] of tasks.entries()) {
    if(task.status==='NOT_RUN')continue;
    const commands=report.commands.filter(command=>command.taskId===task.id);
    assert(commands.length>=1&&commands.length<=plan.tasks[index].commands.length);
    if(task.status==='PASS')assert.equal(commands.length,plan.tasks[index].commands.length);
    for(const [commandIndex,command] of commands.entries()) {
      assert.deepEqual(Object.keys(command).sort(),['taskId','commandIndex','exitCode','signal','resources'].sort());
      assert.equal(command.commandIndex,commandIndex);
      assert(Number.isInteger(command.exitCode)||command.exitCode===null);
      assert(command.signal===null||typeof command.signal==='string');
      if(task.status==='PASS'||commandIndex<commands.length-1) {
        assert.equal(command.exitCode,0);assert.equal(command.signal,null);
        assert(command.resources&&Number.isSafeInteger(command.resources.samples)&&command.resources.samples>=0);
        assert(Number.isSafeInteger(command.resources.detachedProcessesCleaned)&&command.resources.detachedProcessesCleaned>=0);
      }
      expected.push(command);
    }
  }
  assert.deepEqual(report.commands,expected,'Unexecuted, unknown or out-of-order CPU commands');
  return report;
}
export function validateCpuPlan(plan) {
  assert.deepEqual(Object.keys(plan).sort(),['policy','scope','profile','selectionApplied','executionPlatforms','tasks','contractSha256'].sort());
  assert.equal(plan.policy,CATALOG_POLICY);assert.equal(plan.scope,'llama-cpu');assert.equal(plan.profile,'full');assert.equal(plan.selectionApplied,false);assert.deepEqual(plan.executionPlatforms,['linux']);
  const {contractSha256,...definition}=plan;assert.equal(contractSha256,CATALOG_CONTRACT);assert.equal(digest(JSON.stringify(definition)),CATALOG_CONTRACT);
  assert.deepEqual(plan.tasks.map(({id,commands})=>({id,commands})),CPU_TASKS);
  for(const [index,task] of plan.tasks.entries()) {
    assert.equal(task.cwd,'.');assert.deepEqual(task.dependencies,index?[CPU_TASKS[index-1].id]:[]);
    assert.deepEqual(task.platforms,['linux']);assert.deepEqual(task.products,['reader','hear']);assert.equal(task.profile,'full');
  }
  return plan;
}
export function readCpuPlan(source) {
  const bytes=execFileSync(process.execPath,[path.join(source,'scripts/verification-execution.mjs'),'--scope','llama-cpu','--profile','full'],{cwd:source,stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:2*1024*1024});
  return validateCpuPlan(JSON.parse(bytes));
}
export function cpuCoverage(plan,tasks) {
  validateCpuPlan(plan);assert.deepEqual(tasks.map(task=>task.id),CPU_TASKS.map(task=>task.id));
  for(const [index,task] of tasks.entries()) {
    assert(['PASS','FAIL','NOT_RUN'].includes(task.status));
    if(task.status==='PASS') {assert.equal(task.exitCode,0);assert(Number.isSafeInteger(task.durationMs)&&task.durationMs>=0);assert(tasks.slice(0,index).every(prerequisite=>prerequisite.status==='PASS'));}
    if(task.status==='FAIL')assert(task.exitCode!==0);
  }
  return {policy:CATALOG_POLICY,scope:'llama-cpu',profile:'full',selectionApplied:false,contractSha256:CATALOG_CONTRACT,status:tasks.every(task=>task.status==='PASS')?'PASS':tasks.some(task=>task.status==='FAIL')?'FAIL':'INCOMPLETE',tasks:tasks.map(({id,status})=>({id,status}))};
}
export function catalogResult(summary,legacy,bytes,legacyBytes,value,{run,attempt,execution}) {
  const result={schemaVersion:2,kind:'reader-shared-cpu-catalog-verification',binding:binding(value),run:positive(run),attempt:positive(attempt),policy:CATALOG_POLICY,scope:'llama-cpu',profile:'full',selectionApplied:false,catalogContractSha256:CATALOG_CONTRACT,legacyContractSha256:CPU_CONTRACT,executorPolicy:EXECUTOR_POLICY,executorContractSha256:EXECUTOR_CONTRACT,summarySha256:null,legacyReceiptSha256:null,status:'FAIL',tasks:CPU_TASKS.map(({id})=>({id,status:'NOT_RUN'})),acceptance:{cpuCompilation:'NOT_RUN',hearNativeCompilation:'NOT_RUN',scriptedGui:'NOT_RUN',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'}};
  try {
    assert(Buffer.isBuffer(bytes)&&bytes.length<=2*1024*1024);assert(Buffer.isBuffer(legacyBytes));assert.deepEqual(JSON.parse(bytes),summary);assert.deepEqual(JSON.parse(legacyBytes),legacy);
    assert.equal(summary.contract,CPU_CONTRACT);assert.deepEqual(summary.binding,binding(value));assert.equal(summary.run,positive(run));assert.equal(summary.attempt,positive(attempt));assert.equal(summary.scope,'llama-cpu');
    assert.match(summary.executionRunId??'',/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(summary.sourceBefore.head,value.tested);assert.equal(summary.sourceBefore.dirty,false);assert.deepEqual(summary.sourceBefore,summary.sourceAfter);
    validateCpuResult(legacy,value,{run,attempt,mode:'llama-cpu'});
    if(legacy.build)assert.equal(legacy.build.upstreamRevision,summary.sourceBefore.upstreamRevision);
    assert.deepEqual(cpuResult(summary,value,{run,attempt,mode:'llama-cpu',execution,build:legacy.build,diagnostics:legacy.diagnosticsSha256,bytes}),legacy);
    const coverage=cpuCoverage(summary.catalogPlan,summary.tasks);assert.deepEqual(coverage,summary.catalogExecution);
    validateCpuExecution(summary.cpuExecutor,summary.catalogPlan,summary.tasks);
    result.summarySha256=digest(bytes);result.legacyReceiptSha256=digest(legacyBytes);result.tasks=coverage.tasks;
    if(execution==='success'&&legacy.status==='PASS'&&coverage.status==='PASS'){result.status='PASS';result.acceptance.cpuCompilation='PASS';}
  } catch { /* Unbound or incomplete reports cannot supply CPU catalog success. */ }
  return result;
}
