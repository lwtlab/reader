import assert from 'node:assert/strict';
import {binding, digest, positive} from './reader-verification.mjs';

export const CPU_CONTEXT='reader-public/llama-cpu';
export const CPU_ARTIFACT='reader-llama-cpu-result';
export const CPU_JOB='Private Reader llama CPU verification';
// The original private reader-llama job's nine real stages, including prerequisites.
export const CPU_TASKS=Object.freeze([
  {id:'cpu-build',commands:[['git','-c','submodule.third_party/llama.cpp-upstream.url=https://github.com/ggml-org/llama.cpp.git','submodule','update','--init','--','third_party/llama.cpp-upstream'],['node','scripts/build-reader-llama.mjs','--backend','cpu','--jobs','2']]},
  {id:'parity-controls',commands:[['python3','-B','scripts/test_llama_parity.py']]},
  {id:'aligner-overlay',commands:[['python3','-B','scripts/test_reader_aligner_overlay.py']]},
  {id:'speech-release-controls',commands:[['python3','-B','scripts/test_reader_speech_release.py']]},
  {id:'gguf-tooling',commands:[['python3','-m','venv','.llama-build/qa-python'],['.llama-build/qa-python/bin/python','-m','pip','install','./third_party/llama.cpp-upstream/gguf-py']]},
  {id:'asr-conversion',commands:[['.llama-build/qa-python/bin/python','-B','scripts/test_reader_asr_conversion.py']]},
  {id:'model-artifacts',commands:[['.llama-build/qa-python/bin/python','-B','scripts/test_reader_model_artifacts.py']]},
  {id:'aligner-conversion',commands:[['.llama-build/qa-python/bin/python','-B','scripts/test_reader_aligner_conversion.py']]},
  {id:'asr-cli-help',commands:[['.llama-build/upstream-cpu/bin/reader-qwen3-asr','--help']]},
]);
export const CPU_CONTRACT=digest(JSON.stringify({policy:'reader-llama-cpu-v1',tasks:CPU_TASKS}));
export function scope(value='full'){assert(['full','llama-cpu'].includes(value));return value;}
export const cpuFingerprint=(value,mode)=>digest(JSON.stringify({binding:binding(value),contract:CPU_CONTRACT,scope:scope(mode)})).slice(0,24);
const hex=v=>/^[a-f0-9]{64}$/.test(v??'');
export function cpuResult(summary,value,{run,attempt,mode='full',execution,build=null,diagnostics=null,bytes=null}) {
  const stable=summary?.sourceBefore?.head===value.tested && summary.sourceBefore.dirty===false && JSON.stringify(summary.sourceBefore)===JSON.stringify(summary.sourceAfter);
  const exact=summary?.contract===CPU_CONTRACT && JSON.stringify(summary.binding)===JSON.stringify(binding(value)) && summary.run===positive(run) && summary.attempt===positive(attempt) && summary.scope===scope(mode);
  const tasks=CPU_TASKS.map(({id})=>{const t=summary?.tasks?.find(t=>t.id===id);return {id,status:['PASS','FAIL','NOT_RUN'].includes(t?.status)?t.status:'NOT_RUN',durationMs:Number.isFinite(t?.durationMs)&&t.durationMs>=0?t.durationMs:null};});
  const complete=summary?.tasks?.length===CPU_TASKS.length && new Set(summary.tasks.map(t=>t.id)).size===CPU_TASKS.length && summary.tasks.every(t=>t.status==='PASS'&&t.exitCode===0);
  const passed=execution==='success'&&stable&&exact&&complete&&build&&hex(diagnostics)&&bytes;
  return {schemaVersion:1,kind:'reader-public-llama-cpu-verification',binding:binding(value),scope:scope(mode),run:positive(run),attempt:positive(attempt),contractSha256:CPU_CONTRACT,status:passed?'PASS':'FAIL',summarySha256:bytes?digest(bytes):null,diagnosticsSha256:hex(diagnostics)?diagnostics:null,build:build?{...build}:null,tasks};
}
export function validateCpuResult(r,value,{run,attempt,mode='full'}) {
  assert.deepEqual(Object.keys(r).sort(),['schemaVersion','kind','binding','scope','run','attempt','contractSha256','status','summarySha256','diagnosticsSha256','build','tasks'].sort());
  assert.equal(r.schemaVersion,1);assert.equal(r.kind,'reader-public-llama-cpu-verification');assert.deepEqual(r.binding,binding(value));assert.equal(r.scope,scope(mode));assert.equal(r.run,positive(run));assert.equal(r.attempt,positive(attempt));assert.equal(r.contractSha256,CPU_CONTRACT);assert(['PASS','FAIL'].includes(r.status));
  for(const key of ['summarySha256','diagnosticsSha256'])assert(r[key]===null||hex(r[key]));
  assert.equal(r.tasks.length,CPU_TASKS.length);assert.deepEqual(r.tasks.map(t=>t.id),CPU_TASKS.map(t=>t.id));
  for(const t of r.tasks){assert.deepEqual(Object.keys(t).sort(),['id','status','durationMs'].sort());assert(['PASS','FAIL','NOT_RUN'].includes(t.status));assert(t.durationMs===null||(Number.isFinite(t.durationMs)&&t.durationMs>=0));}
  if(r.build!==null){assert.deepEqual(Object.keys(r.build).sort(),['upstreamRevision','manifestSha256','runtimeSha256','bundleSha256','fileCount'].sort());assert.match(r.build.upstreamRevision,/^[a-f0-9]{40}$/);for(const k of ['manifestSha256','runtimeSha256','bundleSha256'])assert(hex(r.build[k]));assert(Number.isSafeInteger(r.build.fileCount)&&r.build.fileCount>=1&&r.build.fileCount<=64);}
  if(r.status==='PASS'){assert(hex(r.summarySha256)&&hex(r.diagnosticsSha256));assert(r.build);assert(r.tasks.every(t=>t.status==='PASS'&&t.durationMs!==null));}
  return r;
}
