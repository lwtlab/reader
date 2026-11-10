import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,copyFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {TASKS,BUILD_REPOSITORY,SOURCE_REPOSITORY,binding,digest,fingerprint,resolvePullRequest,verifyMergeParents,resultFromSummary,validateResult,reportState,dispatchNeeded} from './reader-verification.mjs';
import {github,readReceipt,resolveInput,liveBinding,report,poll} from './reader-verification-control.mjs';
import {decryptLog} from './log-crypto.mjs';

const value=binding({head:'a'.repeat(40),base:'b'.repeat(40),tested:'c'.repeat(40),pr:267,workflow:'d'.repeat(40)});
const policy={trustedAssociations:['OWNER','MEMBER','COLLABORATOR']};
const pull=()=>({number:267,state:'open',author_association:'OWNER',mergeable:true,merge_commit_sha:value.tested,head:{sha:value.head,repo:{full_name:SOURCE_REPOSITORY}},base:{sha:value.base,ref:'main',repo:{full_name:SOURCE_REPOSITORY}}});
const summary=()=>({status:'PASS',profile:'full',source:{head:value.tested,dirty:false},sourceAfter:{head:value.tested,dirty:false},inputs:{sha256:'e'.repeat(64)},inputsAfter:{sha256:'e'.repeat(64)},tasks:TASKS.map(id=>({id,status:'PASS',exitCode:0,durationMs:10}))});
const receipt=()=>resultFromSummary(summary(),value,'success',Buffer.from('synthetic summary'));
const url='https://github.com/lwtlab/reader/actions/runs/123/attempts/1';
const stateInput=()=>({result:receipt(),value,job:'success',run:{id:123,run_attempt:1,repository:{full_name:BUILD_REPOSITORY},head_sha:value.workflow,workflow_id:456,event:'workflow_dispatch'},expectedRun:123,attempt:1,workflowId:456,live:{head:value.head,base:value.base},latest:{target_url:url,description:`full pending ${fingerprint(value)}`}});

test('only exact same-repository trusted PR inputs and verified merge parents are accepted',()=>{
  assert.deepEqual(resolvePullRequest(pull(),value.head,value.workflow,policy,value.base),value);
  verifyMergeParents({sha:value.tested,parents:[{sha:value.base},{sha:value.head}]},value);
  for(const mutate of [p=>p.state='closed',p=>p.author_association='CONTRIBUTOR',p=>p.head.repo.full_name='attacker/fork',p=>p.base.ref='other',p=>p.mergeable=false,p=>p.merge_commit_sha=null,p=>p.head.sha='f'.repeat(40)]) {
    const p=pull();mutate(p);assert.throws(()=>resolvePullRequest(p,value.head,value.workflow,policy,value.base));
  }
  assert.throws(()=>verifyMergeParents({sha:value.tested,parents:[{sha:value.head},{sha:value.base}]},value));
  assert.throws(()=>resolvePullRequest(pull(),'main; echo private',value.workflow,policy,value.base));
});
test('all 33 fresh tasks and exact clean immutable source/input equality are required',()=>{
  validateResult(receipt(),value);
  for(const mutate of [s=>s.status='FAIL',s=>s.profile='push',s=>s.reusedFrom={},s=>s.tasks.pop(),s=>s.tasks[0].status='REUSED',s=>s.tasks[0].exitCode=1,s=>s.tasks[0].id=s.tasks[1].id,s=>s.source.dirty=true,s=>s.source.head=value.head,s=>s.sourceAfter.dirty=true,s=>s.inputsAfter.sha256='f'.repeat(64)]) {
    const s=summary();mutate(s);assert.equal(resultFromSummary(s,value,'success',Buffer.from('s')).status,'FAIL');
  }
  for(const outcome of ['failure','cancelled','skipped',''])assert.equal(resultFromSummary(summary(),value,outcome,Buffer.from('s')).status,'FAIL');
  assert.equal(resultFromSummary(null,value,'success').status,'FAIL');
});
test('public receipts exclude private test text, errors, paths, and arbitrary fields',()=>{
  const s=summary();s.failure='PRIVATE_EXCEPTION';s.source.account='PRIVATE_ACCOUNT';s.tasks[0].reason='PRIVATE_REASON';s.tools={path:'PRIVATE_PATH'};
  const output=resultFromSummary(s,value,'failure',Buffer.from('private summary'));
  assert.doesNotMatch(JSON.stringify(output),/PRIVATE_/);
  for(const mutate of [r=>r.extra='PRIVATE',r=>r.tasks[0].reason='PRIVATE',r=>r.binding.head='f'.repeat(40),r=>r.tasks[0].id='PRIVATE',r=>r.summarySha256='PRIVATE']) {
    const r=receipt();mutate(r);assert.throws(()=>validateResult(r,value));
  }
});
test('failed or cancelled jobs, invalid run provenance, and stale PR heads cannot report green',()=>{
  assert.equal(reportState(stateInput()).state,'success');
  for(const job of ['failure','cancelled','skipped','timed_out'])assert.equal(reportState({...stateInput(),job}).state,'failure');
  assert.equal(reportState({...stateInput(),live:{head:'f'.repeat(40),base:value.base}}).state,'error');
  assert.equal(reportState({...stateInput(),live:{head:value.head,base:'f'.repeat(40)}}).state,'error');
  assert.equal(reportState({...stateInput(),latest:{target_url:'newer run'}}),null);
  for(const mutate of [x=>x.run.id++,x=>x.run.run_attempt++,x=>x.run.repository.full_name='attacker/repo',x=>x.run.head_sha='f'.repeat(40),x=>x.run.workflow_id++,x=>x.run.event='pull_request']) {
    const x=stateInput();mutate(x);assert.throws(()=>reportState(x));
  }
});
test('polling deduplicates failures and active results; new source/base/workflow invalidates the old result',()=>{
  assert(dispatchNeeded(null,value));
  for(const state of ['pending','success','failure','error'])assert.equal(dispatchNeeded({state,description:`full FAIL ${fingerprint(value)}`},value),false);
  for(const key of ['head','base','tested','workflow'])assert(dispatchNeeded({description:`full PASS ${fingerprint(value)}`},{...value,[key]:'f'.repeat(40)}));
});
test('main dispatch rejects arbitrary branches and only accepts current main',async()=>{
  const api=async route=>{assert(route.endsWith('git/ref/heads/main'));return {object:{sha:value.head}};};
  assert.equal((await resolveInput(api,{source:value.head,pr:0,workflow:value.workflow})).tested,value.head);
  await assert.rejects(resolveInput(api,{source:value.base,pr:0,workflow:value.workflow}));
});
test('PR snapshot base may lag main; resolve verifies merge parents against the authoritative Git ref',async()=>{
  const current='f'.repeat(40);
  const api=async route=>{
    if(route.endsWith('pulls/267'))return pull();
    if(route.endsWith('git/ref/heads/main'))return {object:{sha:current}};
    if(route.endsWith(`git/commits/${value.tested}`))return {sha:value.tested,parents:[{sha:current},{sha:value.head}]};
    assert.fail('Unexpected route');
  };
  const resolved=await resolveInput(api,{source:value.head,pr:267,workflow:value.workflow});
  assert.equal(resolved.base,current);
});
test('completion checks also ignore the stale PR base snapshot and read the live Git ref',async()=>{
  const current='f'.repeat(40);
  const api=async route=>route.endsWith('/pulls/267')?pull():{object:{sha:current}};
  assert.deepEqual(await liveBinding(api,value),{head:value.head,base:current});
});
test('automatic discovery defaults off and an enabled poll dispatches only exact unverified inputs',async()=>{
  assert.deepEqual(await poll(()=>assert.fail('Disabled polling must not read private data'),value.workflow),{dispatched:0,disabled:true});
  const sent=[];
  const api=async(route,method,body)=>{
    if(method==='POST'){sent.push(body);return {};}
    if(route.includes('pulls?'))return [];
    if(route.endsWith('git/ref/heads/main'))return {object:{sha:value.head}};
    if(route.endsWith('git/ref/heads/reader-public-full-verification'))return {object:{sha:value.workflow}};
    if(route.includes('/statuses?'))return [];
    assert.fail('Unexpected API route');
  };
  assert.deepEqual(await poll(api,value.workflow,{enabled:true}),{dispatched:1});
  assert.deepEqual(sent,[{ref:'reader-public-full-verification',inputs:{source_ref:value.head,pr_number:'0',workflow_sha:value.workflow}}]);
});
test('controller errors never echo authenticated response content',async()=>{
  const api=github('SYNTHETIC_TOKEN',async(_url,options)=>{assert.match(options.headers.Authorization,/SYNTHETIC_TOKEN/);return {ok:false,status:403,text:async()=> 'PRIVATE_RESPONSE'};});
  await assert.rejects(api('repos/lwtlab/lwt-core/pulls/267'),error=>error.code==='HTTP_403'&&!String(error).includes('PRIVATE_RESPONSE')&&!String(error).includes('SYNTHETIC_TOKEN'));
});
test('artifact digest, run binding, exact ZIP name and redirect authentication are enforced',async()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'reader-receipt-test-'));
  try {
    writeFileSync(path.join(temp,'verification.json'),JSON.stringify(receipt()));
    execFileSync('zip',['-q','result.zip','verification.json'],{cwd:temp});const bytes=readFileSync(path.join(temp,'result.zip'));
    const row={id:999,name:'reader-full-result-123-1',expired:false,workflow_run:{id:123,head_sha:value.workflow},digest:`sha256:${digest(bytes)}`,size_in_bytes:bytes.length};
    const transport=async(address,options)=>{
      if(String(address).startsWith('https://api.github.com/')) {assert.equal(options.headers.Authorization,'Bearer TOKEN');return {status:302,headers:new Headers({location:'https://example.test/signed'})};}
      assert.equal(options.headers,undefined);return {ok:true,body:(async function*(){yield bytes;})()};
    };
    assert.deepEqual(await readReceipt(async()=>({artifacts:[row]}),value,123,1,'TOKEN',transport),receipt());
    for(const changed of [{...row,digest:`sha256:${'0'.repeat(64)}`},{...row,expired:true},{...row,workflow_run:{id:456,head_sha:value.workflow}}])await assert.rejects(readReceipt(async()=>({artifacts:[changed]}),value,123,1,'TOKEN',transport));
    writeFileSync(path.join(temp,'private.txt'),'PRIVATE');execFileSync('zip',['-q','result.zip','private.txt'],{cwd:temp});
    const extra=readFileSync(path.join(temp,'result.zip'));await assert.rejects(readReceipt(async()=>({artifacts:[{...row,digest:`sha256:${digest(extra)}`,size_in_bytes:extra.length}]}),value,123,1,'TOKEN',async(address,options)=>String(address).startsWith('https://api.github.com/')?transport(address,options):{ok:true,body:(async function*(){yield extra;})()}));
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('missing evidence reports error and a newer pending run cannot be overwritten',async()=>{
  const posts=[];let statusReads=0;
  const api=async(route,method,body)=>{
    if(method==='POST'){posts.push(body);return {};}
    if(route.endsWith('/pulls/267'))return pull();
    if(route.endsWith('/git/ref/heads/main'))return {object:{sha:value.base}};
    if(route.includes('/statuses?')){statusReads++;return [{context:'reader-public/full',target_url:statusReads>1?'newer':url,description:`full pending ${fingerprint(value)}`}];}
    if(route.endsWith('/actions/runs/123'))return stateInput().run;
    if(route.includes('/actions/workflows/'))return {id:456};
    if(route.includes('/artifacts?'))return {artifacts:[]};
    if(route.includes('/jobs?'))return {jobs:[{name:'Full private Reader verification',conclusion:'cancelled'}]};
    throw new Error('Unexpected route');
  };
  assert.equal(await report(api,value,{run:123,attempt:1,job:'cancelled',token:'TOKEN'}),'SUPERSEDED');assert.equal(posts.length,0);
  statusReads=-100;
  assert.equal(await report(api,value,{run:123,attempt:1,job:'cancelled',token:'TOKEN'}),'error');assert.equal(posts[0].state,'error');
});
test('hosted verification keeps personal credentials out of test jobs and uploads only named safe artifacts',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8');
  const full=yaml.slice(yaml.indexOf('  full:'),yaml.indexOf('  report:'));
  assert.doesNotMatch(full,/READER_VERIFICATION_TOKEN|INTERNAL_RELEASE_PUBLISH_TOKEN|SIGNING|actions\/cache|pull_request_target/);
  assert.match(full,/persist-credentials: false/);assert.match(full,/node ci\/private-step.mjs full-verification source node scripts\/verify.mjs --profile full/);
  for(const upload of full.split('uses: actions/upload-artifact@').slice(1))assert.match(upload,/path: verification-output\/(verification.json|diagnostics.enc.json)/);
  assert.doesNotMatch(yaml,/pull_request_target|workflow_run:/);
});
test('real receipt and encrypted diagnostic pipeline retains only approved synthetic locations',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'reader-encrypted-test-'));
  try {
    for(const dir of ['ci','source/.artifacts/verify/11111111-1111-1111-1111-111111111111','source/apps/reader/test-results','runtime'])mkdirSync(path.join(temp,dir),{recursive:true});
    for(const name of ['reader-verification-run.mjs','reader-verification.mjs','log-crypto.mjs'])copyFileSync(new URL(name,import.meta.url),path.join(temp,'ci',name));
    const keys=generateKeyPairSync('rsa',{modulusLength:2048});
    writeFileSync(path.join(temp,'ci/build-logs-public.pem'),keys.publicKey.export({type:'spki',format:'pem'}));
    const report=path.join(temp,'source/.artifacts/verify/11111111-1111-1111-1111-111111111111/summary.json');
    writeFileSync(report,JSON.stringify(summary()));
    writeFileSync(path.join(temp,'runtime/reader-private-build.log'),'SYNTHETIC_PRIVATE_LOG');
    writeFileSync(path.join(temp,'source/apps/reader/test-results/trace.zip'),'SYNTHETIC_TRACE');
    writeFileSync(path.join(temp,'source/credentials.json'),'MUST_NOT_RETAIN');
    const invoke=command=>spawnSync(process.execPath,['ci/reader-verification-run.mjs',command],{cwd:temp,encoding:'utf8',env:{...process.env,RUNNER_TEMP:path.join(temp,'runtime'),VERIFICATION_BINDING:JSON.stringify(value),VERIFICATION_OUTCOME:'success'}});
    assert.equal(invoke('receipt').status,0);assert.equal(invoke('require').status,0);
    const sealed=invoke('seal');assert.equal(sealed.status,0,sealed.stderr);assert.doesNotMatch(sealed.stdout+sealed.stderr,/SYNTHETIC_PRIVATE_LOG|SYNTHETIC_TRACE|MUST_NOT_RETAIN/);
    assert.equal(existsSync(path.join(temp,'runtime/reader-private-build.log')),false);
    const archive=decryptLog(JSON.parse(readFileSync(path.join(temp,'verification-output/diagnostics.enc.json'))),keys.privateKey);
    writeFileSync(path.join(temp,'diagnostics.tar.gz'),archive);
    const list=execFileSync('tar',['-tzf','diagnostics.tar.gz'],{cwd:temp,encoding:'utf8'});
    assert.match(list,/summary.json/);assert.match(list,/trace.zip/);assert.match(list,/reader-private-build.log/);assert.doesNotMatch(list,/credentials.json/);
    symlinkSync(path.join(temp,'source/credentials.json'),path.join(temp,'source/apps/reader/test-results/escape'));
    assert.equal(invoke('seal').status,1);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
