// The shared private plan drives commands. The original public nine-stage
// contract remains an independent validator and never borrows Reader full PASS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { binding, digest, positive } from './reader-verification.mjs';
import { CPU_TASKS, CPU_CONTRACT, cpuResult, validateCpuResult } from './llama-cpu-verification.mjs';

export const CATALOG_POLICY = 'reader-hear-source-execution-v1';
export const CATALOG_CONTRACT = '52dd2b12c7dc15c6520e491db000650cca34de2779c238342edc967b8d1031d7';
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
  const result={schemaVersion:1,kind:'reader-shared-cpu-catalog-verification',binding:binding(value),run:positive(run),attempt:positive(attempt),policy:CATALOG_POLICY,scope:'llama-cpu',profile:'full',selectionApplied:false,catalogContractSha256:CATALOG_CONTRACT,legacyContractSha256:CPU_CONTRACT,summarySha256:null,legacyReceiptSha256:null,status:'FAIL',tasks:CPU_TASKS.map(({id})=>({id,status:'NOT_RUN'})),acceptance:{cpuCompilation:'NOT_RUN',hearNativeCompilation:'NOT_RUN',scriptedGui:'NOT_RUN',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'}};
  try {
    assert(Buffer.isBuffer(bytes)&&bytes.length<=2*1024*1024);assert(Buffer.isBuffer(legacyBytes));assert.deepEqual(JSON.parse(bytes),summary);assert.deepEqual(JSON.parse(legacyBytes),legacy);
    assert.equal(summary.contract,CPU_CONTRACT);assert.deepEqual(summary.binding,binding(value));assert.equal(summary.run,positive(run));assert.equal(summary.attempt,positive(attempt));assert.equal(summary.scope,'llama-cpu');
    assert.match(summary.executionRunId??'',/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(summary.sourceBefore.head,value.tested);assert.equal(summary.sourceBefore.dirty,false);assert.deepEqual(summary.sourceBefore,summary.sourceAfter);
    validateCpuResult(legacy,value,{run,attempt,mode:'llama-cpu'});
    if(legacy.build)assert.equal(legacy.build.upstreamRevision,summary.sourceBefore.upstreamRevision);
    assert.deepEqual(cpuResult(summary,value,{run,attempt,mode:'llama-cpu',execution,build:legacy.build,diagnostics:legacy.diagnosticsSha256,bytes}),legacy);
    const coverage=cpuCoverage(summary.catalogPlan,summary.tasks);assert.deepEqual(coverage,summary.catalogExecution);
    result.summarySha256=digest(bytes);result.legacyReceiptSha256=digest(legacyBytes);result.tasks=coverage.tasks;
    if(execution==='success'&&legacy.status==='PASS'&&coverage.status==='PASS'){result.status='PASS';result.acceptance.cpuCompilation='PASS';}
  } catch { /* Unbound or incomplete reports cannot supply CPU catalog success. */ }
  return result;
}
