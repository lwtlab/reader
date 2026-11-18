import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { TASKS, digest } from './reader-verification.mjs';
import { decryptLog, encryptLog } from './log-crypto.mjs';
import { CONTROL_CLASSES, EXTRA_TASKS, POLICY, RELEASE_GATES, planIdentity, planResult, verifyImplementation } from './shadow-plan.mjs';
const value = { head: 'a'.repeat(40), base: 'b'.repeat(40), tested: 'c'.repeat(40), pr: 274, workflow: 'd'.repeat(40) };
const identity = planIdentity(value,123,1), outcomes = { controls:'success',plan:'success' };
function fixture(products = ['reader','hear']) {
  const catalog = [...TASKS,...EXTRA_TASKS].map((id,index) => ({ id, cwd:'GENERATED_PRIVATE_DIRECTORY', command:['node','GENERATED_PRIVATE_COMMAND'], products:[index<TASKS.length?'reader':'hear'], profile:index<14?'quick':'full', dependencies:[] }));
  catalog.find(task=>task.id==='hear-types').dependencies=['hear-tools'];
  catalog.find(task=>task.id==='hear-unit').dependencies=['hear-types'];
  catalog.find(task=>task.id==='core-asr-controls').dependencies=['core-sources'];
  catalog.find(task=>task.id==='core-sources').products=['reader','hear'];
  catalog.find(task=>task.id==='core-asr-controls').products=['reader','hear'];
  catalog.find(task=>task.id==='hear-native').dependencies=['hear-tools','core-asr-controls'];
  catalog.find(task=>task.id==='hear-gui').dependencies=['hear-native','hear-unit'];
  const gates = RELEASE_GATES.map(id=>({id,automatic:false,products:['reader','hear']}));
  const source={head:value.tested,dirty:false,inputHash:'e'.repeat(64),submodules:[]};
  const entries = catalog.filter(task=>(task.profile==='quick'&&task.products.includes('reader'))||task.products.some(p=>products.includes(p)));
  const plan={schemaVersion:1,policy:POLICY,identity:structuredClone(identity),profile:'full',products,changeMetadata:'complete',changesSha256:digest('M\0GENERATED_PRIVATE_PATH\0'),shadowOnly:true,releaseGates:gates,enforcedReaderTasks:TASKS,tasks:entries.map(task=>({...task,status:'NOT_RUN'}))};
  plan.planSha256=digest(JSON.stringify({policy:POLICY,identity,profile:'full',changeMetadata:plan.changeMetadata,products,entries,releaseGates:gates}));
  const pins={catalogSha256:digest(JSON.stringify({catalog,releaseGates:gates}))};
  return { pins, report:{schemaVersion:1,kind:'verification-shadow-plan',source,sourceAfter:structuredClone(source),stable:true,rawChanges:'M\0GENERATED_PRIVATE_PATH\0',catalog,releaseGates:gates,catalogSha256:pins.catalogSha256,plan} };
}
const result = (f, step=outcomes) => planResult(Buffer.from(JSON.stringify(f.report)),value,123,1,step,f.pins);
test('closed shadow projection qualifies the planner without marking product gates PASS',()=>{
  for (const products of [['reader'],['hear'],['reader','hear']]) {
    const f=fixture(products), actual=result(f);assert.equal(actual.status,'PASS');assert.deepEqual(actual.products,products);
    assert.deepEqual(actual.controls,CONTROL_CLASSES.map(id=>({id,kind:'generated-git-control',status:'PASS'})));
    assert.equal(actual.mandatoryReaderTasks.length,33);assert(actual.mandatoryReaderTasks.every(task=>task.status==='NOT_RUN'));
    assert(actual.plannedTasks.every(task=>task.status==='NOT_RUN'));assert(actual.releaseGates.every(task=>task.status==='NOT_RUN'));
    assert(Object.values(actual.acceptance).every(status=>status==='NOT_RUN'));assert.equal(actual.selectionApplied,false);
    assert.doesNotMatch(JSON.stringify(actual),/GENERATED_PRIVATE/);
  }
});
test('missing, changed, dirty, stale and graph-incomplete reports fail closed',()=>{
  for (const mutate of [
    f=>{f.report.source.dirty=true;}, f=>{f.report.sourceAfter.inputHash='f'.repeat(64);},
    f=>{f.report.plan.identity.head='f'.repeat(40);}, f=>{f.report.stable=false;},
    f=>{f.report.catalog[0].command=['private-changed'];},f=>{f.report.plan.tasks.pop();},
    f=>{f.report.plan.tasks[0].status='PASS';}, f=>{f.report.plan.tasks[0].status='REUSED';},
    f=>{f.report.plan.enforcedReaderTasks=TASKS.slice(1);}, f=>{f.report.plan.changesSha256='0'.repeat(64);},
    f=>{f.report.plan.planSha256='0'.repeat(64);}, f=>{f.report.plan.tasks[0].dependencies=['unknown'];},
    f=>{f.report.plan.products=['hear','reader'];}, f=>{f.report.plan.policy='unreviewed';},
    f=>{f.report.plan.changeMetadata='invalid';f.report.plan.products=['hear'];},
  ]) {const f=fixture();mutate(f);const actual=result(f);assert.equal(actual.status,'FAIL');assert.equal(actual.summarySha256,null);assert(actual.controls.every(c=>c.status==='NOT_RUN'));}
  for(const bytes of [null,Buffer.from('incomplete'),Buffer.alloc(2*1024*1024+1)])assert.equal(planResult(bytes,value,123,1,outcomes,fixture().pins).status,'FAIL');
});
test('actual failed, skipped, cancelled or missing steps cannot qualify a valid plan',()=>{
  for (const step of ['failure','skipped','cancelled',undefined]) for(const key of ['controls','plan']) {
    const actual=result(fixture(),{...outcomes,[key]:step});assert.equal(actual.validation,'PASS');assert.equal(actual.status,'FAIL');
    assert(actual.plannedTasks.every(task=>task.status==='NOT_RUN'));
    if(key==='controls')assert(actual.controls.every(c=>c.status==='NOT_RUN'));
  }
});
test('comma-joined product aliases cannot shrink a forged plan to mandatory quick tasks',()=>{
  const f=fixture(['reader,hear']);assert.equal(f.report.plan.tasks.length,14);
  const actual=result(f);assert.equal(actual.status,'FAIL');assert.equal(actual.validation,'FAIL');assert.equal(actual.summarySha256,null);
});
test('original private plan bytes authenticate while the receipt stays bounded',()=>{
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const f=fixture(),bytes=Buffer.from(JSON.stringify(f.report)+'\n');
  const encrypted=encryptLog(bytes,publicKey);assert.deepEqual(decryptLog(encrypted,privateKey),bytes);
  assert.equal(planResult(bytes,value,123,1,outcomes,f.pins).summarySha256,digest(bytes));
  const tampered={...encrypted,data:encrypted.data.slice(0,-4)+'AAAA'};
  assert.throws(()=>decryptLog(tampered,privateKey));
});
test('reviewed implementation checks reject modified or linked files',t=>{
  const folder=mkdtempSync(join(tmpdir(),'shadow-implementation-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const file=join(folder,'generated.mjs');writeFileSync(file,'GENERATED_IMPLEMENTATION');
  const pins={'generated.mjs':digest('GENERATED_IMPLEMENTATION')};verifyImplementation(folder,pins);
  writeFileSync(file,'CHANGED_IMPLEMENTATION');assert.throws(()=>verifyImplementation(folder,pins));
  writeFileSync(join(folder,'other.mjs'),'GENERATED_IMPLEMENTATION');rmSync(file);symlinkSync(join(folder,'other.mjs'),file);
  assert.throws(()=>verifyImplementation(folder,pins));
});
test('actual collector produces a failed receipt for unreviewed source and rejects tampering',t=>{
  const folder=mkdtempSync(join(tmpdir(),'shadow-collector-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  mkdirSync(join(folder,'source'));mkdirSync(join(folder,'runtime'));
  const env={...process.env,GITHUB_REPOSITORY:'lwtlab/reader',GITHUB_SHA:value.workflow,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',VERIFICATION_BINDING:JSON.stringify(value),RUNNER_TEMP:join(folder,'runtime'),SHADOW_CONTROLS_OUTCOME:'success',SHADOW_PLAN_OUTCOME:'success'};
  const cli=fileURLToPath(new URL('./shadow-plan.mjs',import.meta.url));
  const invoke=mode=>spawnSync(process.execPath,[cli,mode],{cwd:folder,env,encoding:'utf8'});
  assert.equal(invoke('identity').status,1);assert.equal(invoke('collect').status,0);
  const file=join(folder,'shadow-plan-output/verification.json');let receipt=JSON.parse(readFileSync(file));assert.equal(receipt.status,'FAIL');assert.equal(receipt.summarySha256,null);
  assert.equal(invoke('require').status,1);receipt.status='PASS';writeFileSync(file,JSON.stringify(receipt));assert.equal(invoke('require').status,1);
});
test('workflow isolates optional shadow scope and never uploads private plan bytes',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8'),block=yaml.slice(yaml.indexOf('  shadow-plan:'),yaml.indexOf('  catalog-cpu:'));
  assert.match(block,/if: inputs.scope == 'shadow-plan'/);assert.match(block,/fetch-depth: 0/);
  assert.match(block,/node --test scripts\/verification-catalog.test.mjs/);assert.match(block,/scripts\/verification-catalog.mjs --ci/);
  assert.match(block,/SHADOW_CONTROLS_OUTCOME: \$\{\{ steps.controls.outcome \}\}/);assert.match(block,/SHADOW_PLAN_OUTCOME: \$\{\{ steps.plan.outcome \}\}/);
  assert.match(block,/node ci\/shadow-plan.mjs require/);assert.doesNotMatch(block,/READER_VERIFICATION_TOKEN|SIGNING|pnpm|pull_request_target|continue-on-error/);
  for(const upload of block.split('uses: actions/upload-artifact@').slice(1))assert.match(upload,/path: shadow-plan-output\/(verification.json|\*.enc.json)/);
  const control=readFileSync(new URL('./reader-verification-control.mjs',import.meta.url),'utf8');
  assert(control.indexOf("if(mode==='shadow-plan'||mode==='catalog-cpu')")<control.indexOf("if(mode==='full')await postStatus"));
  assert.match(yaml,/report-llama-cpu:[\s\S]+inputs.scope != 'shadow-plan'/);
  assert.match(yaml,/full:[\s\S]+inputs.scope != 'llama-cpu' && inputs.scope != 'shadow-plan'/);
});
