import assert from 'node:assert/strict';
import {binding,digest,positive} from './reader-verification.mjs';
export const RELIABILITY_ARTIFACT='reader-reliability-result';
export const RELIABILITY_JOB='Private Reader reliability verification';
export const CHECKS_JOB='Private Reader independent checks';
export const profiles=Object.freeze({
  'sync-journey':{context:'reader-public/sync-journey',timeout:25,tasks:[{id:'sync-journey',command:['pnpm','test:sync-journey']}]},
  'large-library':{context:'reader-public/large-library',timeout:60,tasks:[{id:'large-library',command:['pnpm','test:reader-reliability','--profile=large']}]},
  'playback-soak':{context:'reader-public/playback-soak',timeout:180,tasks:[{id:'playback-soak',command:['pnpm','test:reader-reliability:soak']}]},
  'public-integration':{context:'reader-public/public-integration',job:CHECKS_JOB,timeout:25,tasks:[
    {id:'privacy-source-parity',cwd:'.',command:['node','scripts/sync-release-privacy.mjs','--check']},
    {id:'public-delivery-checks',cwd:'.',command:['bash','scripts/reader-public.sh','check']},
  ]},
  'release-privacy':{context:'reader-public/release-privacy',job:CHECKS_JOB,timeout:25,tasks:[
    {id:'privacy-negative-controls',cwd:'.',command:['node','--test','scripts/release/privacy.test.mjs']},
    {id:'extension-privacy',cwd:'.',command:['node','scripts/release-privacy.mjs','apps/reader/extension']},
  ]},
});
export function profile(value){assert(Object.hasOwn(profiles,value),'Unknown reliability profile');return value;}
export const contract=p=>digest(JSON.stringify({policy:'reader-reliability-v1',profile:profile(p),...profiles[p]}));
export const fingerprint=(value,p)=>digest(JSON.stringify({binding:binding(value),contract:contract(p)})).slice(0,24);
const hex=v=>/^[a-f0-9]{64}$/.test(v??'');
export function result(summary,value,{profile:p,run,attempt,execution,bytes=null,diagnostics=null}){
  profile(p);positive(run);positive(attempt);
  const tasks=profiles[p].tasks.map(({id})=>{const t=summary?.tasks?.find(t=>t.id===id);return {id,status:['PASS','FAIL','NOT_RUN'].includes(t?.status)?t.status:'NOT_RUN',durationMs:Number.isFinite(t?.durationMs)&&t.durationMs>=0?t.durationMs:null};});
  const stable=summary?.sourceBefore?.head===value.tested&&summary.sourceBefore.dirty===false&&JSON.stringify(summary.sourceBefore)===JSON.stringify(summary.sourceAfter);
  const exact=summary?.contractSha256===contract(p)&&JSON.stringify(summary.binding)===JSON.stringify(binding(value))&&summary.run===run&&summary.attempt===attempt&&summary.profile===p;
  const complete=summary?.tasks?.length===tasks.length&&new Set(summary.tasks.map(t=>t.id)).size===tasks.length&&summary.tasks.every(t=>t.status==='PASS'&&t.exitCode===0&&Number.isFinite(t.durationMs)&&t.durationMs>=0)&&tasks.every(t=>t.status==='PASS');
  return {schemaVersion:1,kind:'reader-public-reliability-verification',binding:binding(value),profile:p,run,attempt,contractSha256:contract(p),status:execution==='success'&&stable&&exact&&complete&&bytes&&hex(diagnostics)?'PASS':'FAIL',summarySha256:bytes?digest(bytes):null,diagnosticsSha256:hex(diagnostics)?diagnostics:null,tasks};
}
export function validateResult(r,value,{profile:p,run,attempt}){
  assert.deepEqual(Object.keys(r).sort(),['schemaVersion','kind','binding','profile','run','attempt','contractSha256','status','summarySha256','diagnosticsSha256','tasks'].sort());
  assert.equal(r.schemaVersion,1);assert.equal(r.kind,'reader-public-reliability-verification');assert.deepEqual(r.binding,binding(value));assert.equal(r.profile,profile(p));assert.equal(r.run,positive(run));assert.equal(r.attempt,positive(attempt));assert.equal(r.contractSha256,contract(p));assert(['PASS','FAIL'].includes(r.status));
  for(const key of ['summarySha256','diagnosticsSha256'])assert(r[key]===null||hex(r[key]));
  assert.deepEqual(r.tasks.map(t=>t.id),profiles[p].tasks.map(t=>t.id));
  for(const t of r.tasks){assert.deepEqual(Object.keys(t).sort(),['id','status','durationMs'].sort());assert(['PASS','FAIL','NOT_RUN'].includes(t.status));assert(t.durationMs===null||(Number.isFinite(t.durationMs)&&t.durationMs>=0));}
  if(r.status==='PASS'){assert(hex(r.summarySha256)&&hex(r.diagnosticsSha256));assert(r.tasks.every(t=>t.status==='PASS'&&t.durationMs!==null));}
  return r;
}
