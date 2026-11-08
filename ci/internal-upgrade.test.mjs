import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseAcceptance, resolveAcceptance, restoreMissingBlockmaps, nativeProducerProvenance } from './internal-upgrade.mjs';

test('upgrade inputs require immutable tooling and numeric artifact run IDs', () => {
  const input = { baselineRun: '42449632255', candidateRun: '234567', toolingSha: 'a'.repeat(40) };
  assert.deepEqual(parseAcceptance(JSON.stringify(input)), input);
  for (const bad of [{...input, toolingSha: 'main'}, {...input, candidateRun: '../x'}, {...input, extra: true}])
    assert.throws(() => parseAcceptance(JSON.stringify(bad)));
});
test('omitted blockmaps can only be restored as the exact originally indexed bytes', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reader-map-restore-'));
  const row = (name, data) => ({name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')});
  const payload = Buffer.from('installer'), map = Buffer.from('original deterministic metadata');
  try {
    writeFileSync(path.join(directory, 'app.exe'), payload);
    writeFileSync(path.join(directory, 'desktop-artifacts.json'), JSON.stringify({artifacts: [row('app.exe', payload), row('app.exe.blockmap', map)]}));
    assert.throws(() => restoreMissingBlockmaps(directory, (_, output) => writeFileSync(output, 'changed metadata')));
    assert.equal(existsSync(path.join(directory, 'app.exe.blockmap')), false);
    restoreMissingBlockmaps(directory, (_, output) => writeFileSync(output, map));
    assert.equal(existsSync(path.join(directory, 'app.exe.blockmap')), true);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
test('upgrade artifacts require successful native jobs and unexpired exact named artifacts', async () => {
  const input = { baselineRun: '42449632255', candidateRun: '234567', toolingSha: 'a'.repeat(40) };
  const request = async endpoint => {
    const candidate = endpoint.includes('234567');
    if (endpoint.includes('/jobs?')) return {jobs: [{name: candidate ? 'internal-linux-x64' : 'baseline-linux-x64', conclusion: 'success'}]};
    if (endpoint.includes('/artifacts?')) return {artifacts: [{name: `reader-${candidate ? 'internal-' : ''}linux-x64-candidate`, expired: false}]};
    return {event: 'workflow_dispatch', path: '.github/workflows/desktop-candidates.yml', head_sha: 'd5f8a4a24df7897244ea3ba300f3ae2c4dd8c5d2', repository: {full_name: 'lwtlab/reader'}};
  };
  await resolveAcceptance(input, 'linux-x64', request);
  await assert.rejects(resolveAcceptance(input, 'linux-x64', async endpoint => endpoint.includes('/artifacts?') ? {artifacts: []} : request(endpoint)));
});


test('published baseline inputs use durable release catalogs and require no baseline Actions run', async () => {
  const input = {baselineVersion: '0.25.0', candidateRun: '234567', toolingSha: 'a'.repeat(40)};
  assert.deepEqual(parseAcceptance(JSON.stringify(input)), input);
  for (const value of ['../private', 'main', '0.25.0/path', '025.0.0'])
    assert.throws(() => parseAcceptance(JSON.stringify({...input, baselineVersion: value})));
  assert.throws(() => parseAcceptance(JSON.stringify({...input, baselineRun: '123456'})));
  const endpoints = [];
  await resolveAcceptance(input, 'darwin-x64', async endpoint => {
    endpoints.push(endpoint);
    if (endpoint.includes('/jobs?')) return {jobs: [{name: 'internal-darwin-x64', conclusion: 'success'}]};
    if (endpoint.includes('/artifacts?')) return {artifacts: [{name: 'reader-internal-darwin-x64-candidate', expired: false}]};
    return {event: 'workflow_dispatch', path: '.github/workflows/desktop-candidates.yml', repository: {full_name: 'lwtlab/reader'}};
  });
  assert.equal(endpoints.length, 3);
});

test('new native candidates require a successful whole run and both immutable package and receipt artifacts',async()=>{
 const input={baselineVersion:'0.25.0',candidateRun:'234567',toolingSha:'a'.repeat(40)};
 const request=async endpoint=>{
  if(endpoint.includes('/jobs?'))return {jobs:[{name:'release-desktop-linux-x64',conclusion:'success'}]};
  if(endpoint.includes('/artifacts?'))return {artifacts:[{id:101,name:'reader-release-desktop-linux-x64-packages',digest:'sha256:'+'b'.repeat(64),expired:false},{id:102,name:'reader-release-desktop-linux-x64-receipt',digest:'sha256:'+'c'.repeat(64),expired:false}]};
  return {event:'workflow_dispatch',path:'.github/workflows/desktop-candidates.yml',repository:{full_name:'lwtlab/reader'},status:'completed',conclusion:'success',head_sha:'d'.repeat(40),run_attempt:1};
 };
 const resolved=await resolveAcceptance(input,'linux-x64',request);
 assert.equal(resolved.candidateKind,'producer');assert.equal(resolved.candidateArtifactId,101);assert.equal(resolved.candidateReceiptId,102);
 await assert.rejects(resolveAcceptance(input,'linux-x64',async endpoint=>endpoint.includes('/artifacts?')?{artifacts:(await request(endpoint)).artifacts.slice(0,1)}:request(endpoint)));
 await assert.rejects(resolveAcceptance(input,'linux-x64',async endpoint=>endpoint.includes('/jobs?')||endpoint.includes('/artifacts?')?request(endpoint):{...await request(endpoint),conclusion:'failure'}));
});

test('pinned upgrade workflow drift is rejected before any artifact lookup or private access',async()=>{
 const input=parseAcceptance(JSON.stringify({baselineVersion:'0.25.0',candidateRun:'234567',toolingSha:'a'.repeat(40),workflowSha:'b'.repeat(40)}));
 let calls=0;
 await assert.rejects(resolveAcceptance(input,'linux-x64',async()=>{calls++;throw Error('Unexpected access');},'c'.repeat(40)),/pin the executing workflow/);
 assert.equal(calls,0);
});

test('native upgrade receipt cannot relabel another source, attempt, workflow or payload pair',()=>{
 const index={platform:'linux',arch:'x64',version:'0.26.0',artifacts:[{name:'reader.AppImage',sha256:'b'.repeat(64),bytes:10},{name:'reader.deb',sha256:'c'.repeat(64),bytes:20}]};
 const options={sourceSha:'a'.repeat(40),runId:234567,artifactId:101,workflowSha:'d'.repeat(40),attempt:1};
 const receipt={schemaVersion:1,kind:'reader-release-target',sourceSha:options.sourceSha,target:'desktop-linux-x64',version:index.version,delivery:{repository:'lwtlab/reader',runId:234567,artifactId:101,workflowSha:options.workflowSha,attempt:1},artifacts:index.artifacts.map(a=>({originalBuildName:a.name,sha256:a.sha256,bytes:a.bytes}))};
 assert.equal(nativeProducerProvenance(receipt,index,options).source.commit,options.sourceSha);
 for(const patch of [{sourceSha:'e'.repeat(40)},{artifactId:999},{attempt:2},{workflowSha:'e'.repeat(40)}])assert.throws(()=>nativeProducerProvenance(receipt,index,{...options,...patch}));
 assert.throws(()=>nativeProducerProvenance({...receipt,artifacts:receipt.artifacts.slice(0,1)},index,options));
});
