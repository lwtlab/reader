import assert from 'node:assert/strict';
import {binding,digest,positive} from './reader-verification.mjs';
import {MATRIX,STEPS,CONTRACT} from './reader-native-tts-contract.mjs';
export {MATRIX,STEPS,CONTRACT};
export const NATIVE_CONTEXT='reader-public/native-tts';
export const NATIVE_ARTIFACT='reader-native-tts-result';
export const NATIVE_JOB='Collect seven native TTS results';
export const nativeJob=id=>`Private Reader native TTS (${id})`;
export const nativeFingerprint=v=>digest(JSON.stringify({binding:binding(v),contract:CONTRACT,scope:'native-tts'})).slice(0,24);
const hash=v=>/^[a-f0-9]{64}$/.test(v??'');
const keys=(o,k)=>assert.deepEqual(Object.keys(o).sort(),k.split(' ').sort());
export function validatePlatform(r,value,{run,attempt,id}) {
  const m=MATRIX.find(x=>x.id===id);assert(m);
  keys(r,'schemaVersion kind binding run attempt contractSha256 id host status summarySha256 diagnosticsSha256 build steps');
  assert.equal(r.schemaVersion,1);assert.equal(r.kind,'reader-native-tts-platform');assert.deepEqual(r.binding,binding(value));assert.equal(r.run,positive(run));assert.equal(r.attempt,positive(attempt));assert.equal(r.contractSha256,CONTRACT);assert.equal(r.id,id);
  assert(['PASS','FAIL'].includes(r.status));keys(r.host,'platform arch backend');assert.deepEqual(r.host,{platform:m.platform,arch:m.arch,backend:m.backend});
  for(const k of ['summarySha256','diagnosticsSha256'])assert(r[k]===null||hash(r[k]));
  assert.deepEqual(r.steps.map(x=>x.id),STEPS);
  for(const t of r.steps){keys(t,'id status durationMs');assert(['PASS','FAIL','NOT_RUN'].includes(t.status));assert(t.durationMs===null||(Number.isFinite(t.durationMs)&&t.durationMs>=0));}
  if(r.build!==null){keys(r.build,'upstreamRevision manifestSha256 binarySha256 librariesSha256');assert.match(r.build.upstreamRevision,/^[a-f0-9]{40}$/);for(const k of ['manifestSha256','binarySha256','librariesSha256'])assert(hash(r.build[k]));}
  if(r.status==='PASS'){assert(hash(r.summarySha256)&&hash(r.diagnosticsSha256)&&r.build);assert(r.steps.every(t=>t.status==='PASS'&&t.durationMs!==null));}
  return r;
}
export function validateNativeResult(r,value,{run,attempt}) {
  keys(r,'schemaVersion kind binding run attempt contractSha256 status platforms');assert.equal(r.schemaVersion,1);assert.equal(r.kind,'reader-public-native-tts-verification');assert.deepEqual(r.binding,binding(value));assert.equal(r.run,positive(run));assert.equal(r.attempt,positive(attempt));assert.equal(r.contractSha256,CONTRACT);assert(['PASS','FAIL'].includes(r.status));
  assert.deepEqual(r.platforms.map(x=>x.id),MATRIX.map(x=>x.id));
  for(const row of r.platforms){keys(row,'id receipt');if(row.receipt!==null)validatePlatform(row.receipt,value,{run,attempt,id:row.id});}
  if(r.status==='PASS')assert(r.platforms.every(x=>x.receipt?.status==='PASS'));
  return r;
}
export function validateNativeJobs(jobs) {
  for(const name of [NATIVE_JOB,...MATRIX.map(x=>nativeJob(x.id))]){const rows=jobs.filter(j=>j.name===name);assert.equal(rows.length,1);assert.equal(rows[0].status,'completed');assert.equal(rows[0].conclusion,'success');}
}
