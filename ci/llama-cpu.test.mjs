import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,copyFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import test from 'node:test';
import {binding,digest,TASKS,resultFromSummary} from './reader-verification.mjs';
import {CPU_TASKS,CPU_CONTRACT,CPU_CONTEXT,CPU_JOB,cpuResult,validateCpuResult,cpuFingerprint,scope} from './llama-cpu-verification.mjs';
import {executeTasks,checkedBuild,snapshot} from './llama-cpu-run.mjs';
import {pendingCpu,reportCpu} from './llama-cpu-control.mjs';
import {readReceipt} from './reader-verification-control.mjs';
import {decryptLog} from './log-crypto.mjs';

const value=binding({head:'a'.repeat(40),base:'b'.repeat(40),tested:'c'.repeat(40),pr:274,workflow:'d'.repeat(40)});
const options={run:123,attempt:1,mode:'llama-cpu',execution:'success',build:{upstreamRevision:'e'.repeat(40),manifestSha256:'f'.repeat(64),runtimeSha256:'0'.repeat(64),bundleSha256:'1'.repeat(64),fileCount:1},diagnostics:'2'.repeat(64),bytes:Buffer.from('synthetic private summary')};
const summary=()=>({binding:value,run:123,attempt:1,scope:'llama-cpu',contract:CPU_CONTRACT,sourceBefore:{head:value.tested,dirty:false},sourceAfter:{head:value.tested,dirty:false},tasks:CPU_TASKS.map(({id})=>({id,status:'PASS',exitCode:0,durationMs:5}))});
const receipt=()=>cpuResult(summary(),value,options);

test('nine stages preserve every original CPU control, exact gitlink initialization and CLI smoke',()=>{
 assert.equal(CPU_TASKS.length,9);assert.equal(new Set(CPU_TASKS.map(t=>t.id)).size,9);
 const commands=CPU_TASKS.flatMap(t=>t.commands.map(c=>c.join(' '))).join('\n');
 for(const script of ['test_llama_parity.py','test_reader_aligner_overlay.py','test_reader_speech_release.py','test_reader_asr_conversion.py','test_reader_model_artifacts.py','test_reader_aligner_conversion.py'])assert(commands.includes(script));
 assert(commands.includes('--backend cpu --jobs 2'));assert(commands.includes('reader-qwen3-asr --help'));assert(commands.includes('https://github.com/ggml-org/llama.cpp.git'));assert(!commands.includes('--recursive'));
 assert.throws(()=>scope('unknown'));assert.equal(scope(),'full');
});
test('executor stops on failure inside a stage and preserves all unexecuted tasks as NOT_RUN',async()=>{
 const s=summary();s.tasks.forEach(t=>Object.assign(t,{status:'NOT_RUN',exitCode:null,durationMs:null}));let calls=0;const persisted=[];const logs=[];
 assert.equal(await executeTasks(s,'unused',c=>logs.push(c.toString()),{execute:async()=>({code:++calls===2?1:0}),now:(()=>{let t=0;return()=>++t})(),persist:r=>persisted.push(structuredClone(r))}),false);
 assert.equal(calls,2);assert.equal(s.tasks[0].status,'FAIL');assert(s.tasks.slice(1).every(t=>t.status==='NOT_RUN'));assert.equal(persisted.length,1);
 const ok=summary();ok.tasks.forEach(t=>Object.assign(t,{status:'NOT_RUN',exitCode:null,durationMs:null}));assert.equal(await executeTasks(ok,'unused',()=>{}, {execute:async()=>({code:0})}),true);assert(ok.tasks.every(t=>t.status==='PASS'));
});
test('CPU PASS requires exact binding, fresh clean source, all stages, build validation and encrypted diagnostics',()=>{
 validateCpuResult(receipt(),value,options);
 for(const edit of [s=>s.contract='0'.repeat(64),s=>s.binding.head='f'.repeat(40),s=>s.run++,s=>s.attempt++,s=>s.scope='full',s=>s.sourceBefore.dirty=true,s=>s.sourceAfter.head='f'.repeat(40),s=>s.tasks.pop(),s=>s.tasks[0].id=s.tasks[1].id,s=>s.tasks[0].status='NOT_RUN',s=>s.tasks[0].exitCode=1]){const s=structuredClone(summary());edit(s);assert.equal(cpuResult(s,value,options).status,'FAIL');}
 for(const delta of [{execution:'failure'},{execution:'cancelled'},{execution:'skipped'},{build:null},{diagnostics:null},{bytes:null}])assert.equal(cpuResult(summary(),value,{...options,...delta}).status,'FAIL');
 assert.equal(cpuResult(null,value,{...options,build:null,bytes:null}).status,'FAIL');
});
test('CPU receipt has a closed schema; private output and full receipts cannot satisfy it',()=>{
 const s=summary();s.private='PRIVATE_USER_TEXT';s.tasks[0].error='PRIVATE_EXCEPTION';const r=cpuResult(s,value,options);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
 for(const mutate of [r=>r.private='PRIVATE',r=>r.tasks[0].error='PRIVATE',r=>r.build.private='PRIVATE',r=>r.run++,r=>r.scope='full',r=>r.contractSha256='0'.repeat(64),r=>r.tasks[0].status='REUSED',r=>r.build.runtimeSha256='PRIVATE',r=>r.diagnosticsSha256=null]){const r=receipt();mutate(r);assert.throws(()=>validateCpuResult(r,value,options));}
 const full=resultFromSummary(null,value,'failure');assert.throws(()=>validateCpuResult(full,value,options));assert.equal(TASKS.length,33);
 assert.notEqual(cpuFingerprint(value,'full'),cpuFingerprint(value,'llama-cpu'));
});
const url='https://github.com/lwtlab/reader/actions/runs/123/attempts/1';
function apiFixture({runEdit=()=>{},jobsEdit=()=>{},statusEdit=()=>{},liveEdit=()=>{}}={}){
 const posted=[];let reads=0;
 const api=async(route,method,body)=>{
  if(method==='POST'){posted.push(body);return {};}
  if(route.endsWith('/pulls/274'))return {state:'open',head:{sha:value.head}};
  if(route.endsWith('/git/ref/heads/main')){const v={object:{sha:value.base}};liveEdit(v);return v;}
  if(route.includes('/statuses?')){const s={context:CPU_CONTEXT,target_url:url,description:`cpu pending ${cpuFingerprint(value,'llama-cpu')}`};statusEdit(s,++reads);return [s];}
  if(route.endsWith('/actions/runs/123')){const r={id:123,run_attempt:1,repository:{full_name:'lwtlab/reader'},head_sha:value.workflow,workflow_id:456,event:'workflow_dispatch'};runEdit(r);return r;}
  if(route.includes('/actions/workflows/'))return {id:456};
  if(route.includes('/jobs?')){const r={jobs:[{name:CPU_JOB,conclusion:'success'}]};jobsEdit(r);return r;}
  assert.fail('Unexpected API route');
 };
 return {api,posted};
}
test('focused pending/report touches only CPU context; no full status is created',async()=>{
 const f=apiFixture();await pendingCpu(f.api,value,options);assert.equal(f.posted[0].context,CPU_CONTEXT);
 assert.equal(await reportCpu(f.api,value,{...options,job:'success',token:'TOKEN',receipt:async()=>receipt()}),'success');assert(f.posted.every(p=>p.context===CPU_CONTEXT));
});
test('CPU reporter rejects wrong workflow/run/attempt, missing or wrong-scope receipts and changed source',async()=>{
 for(const config of [{runEdit:r=>r.id++},{runEdit:r=>r.run_attempt++},{runEdit:r=>r.head_sha='f'.repeat(40)},{runEdit:r=>r.repository.full_name='attacker/repo'},{runEdit:r=>r.workflow_id++},{runEdit:r=>r.event='pull_request'},{jobsEdit:r=>r.jobs[0].name='Full private Reader verification'},{liveEdit:r=>r.object.sha='f'.repeat(40)}]){
  const f=apiFixture(config);assert.equal(await reportCpu(f.api,value,{...options,job:'success',token:'TOKEN',receipt:async()=>receipt()}),'error');assert.equal(f.posted.at(-1).state,'error');
 }
 for(const read of [async()=>{throw Error('missing')},async()=>({...receipt(),scope:'full'}),async()=>resultFromSummary(null,value,'failure')]){const f=apiFixture();assert.equal(await reportCpu(f.api,value,{...options,job:'success',token:'TOKEN',receipt:read}),'error');}
 const f=apiFixture({statusEdit:(s,count)=>{if(count>1)s.target_url='newer'}});assert.equal(await reportCpu(f.api,value,{...options,job:'success',token:'TOKEN',receipt:async()=>receipt()}),'SUPERSEDED');assert.equal(f.posted.length,0);
});
test('CPU job/receipt failure, including seal or upload failure, cannot turn green',async()=>{
 for(const outcome of ['failure','cancelled','skipped','timed_out']){const f=apiFixture({jobsEdit:r=>r.jobs[0].conclusion=outcome});assert.equal(await reportCpu(f.api,value,{...options,job:outcome,token:'TOKEN',receipt:async()=>receipt()}),'failure');}
 const f=apiFixture();assert.equal(await reportCpu(f.api,value,{...options,job:'success',token:'TOKEN',receipt:async()=>({...receipt(),status:'FAIL'})}),'failure');
});
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'reader-cpu-test-')),source=path.join(dir,'source'),upstream=path.join(source,'third_party/llama.cpp-upstream');mkdirSync(upstream,{recursive:true});
 const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const init=cwd=>{git(cwd,['init','-q']);git(cwd,['config','user.name','Synthetic test']);git(cwd,['config','user.email','synthetic@example.invalid']);};
 init(upstream);writeFileSync(path.join(upstream,'LICENSE'),'SYNTHETIC PUBLIC LICENSE');git(upstream,['add','LICENSE']);git(upstream,['-c','core.hooksPath=/dev/null','commit','-qm','synthetic','--no-gpg-sign']);const revision=git(upstream,['rev-parse','HEAD']);
 init(source);writeFileSync(path.join(source,'.gitignore'),'.llama-build/\n');writeFileSync(path.join(source,'.gitmodules'),'[submodule \"third_party/llama.cpp-upstream\"]\n path = third_party/llama.cpp-upstream\n url = https://github.com/ggml-org/llama.cpp.git\n');git(source,['add','.gitignore','.gitmodules']);git(source,['update-index','--add','--cacheinfo',`160000,${revision},third_party/llama.cpp-upstream`]);git(source,['-c','core.hooksPath=/dev/null','commit','-qm','synthetic','--no-gpg-sign']);
 const bin=path.join(source,'.llama-build/upstream-cpu/bin');mkdirSync(bin,{recursive:true});writeFileSync(path.join(bin,'reader-qwen3-asr'),'SYNTHETIC_GENERATED_BINARY');const build={runtime:'upstream-asr',backend:'cpu',platform:'linux',arch:'x64',revision,files:{'reader-qwen3-asr':digest(readFileSync(path.join(bin,'reader-qwen3-asr')))}};
 writeFileSync(path.join(bin,'../reader-build.json'),JSON.stringify(build));copyFileSync(path.join(upstream,'LICENSE'),path.join(bin,'../LICENSE.llama.cpp'));return {dir,source,upstream,bin,revision,build,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('real build validation checks exact upstream, generated file hashes, license and symlink containment',()=>{
 const f=fixture();try{const snap=snapshot(f.source);const proof=checkedBuild(f.source,snap);assert.equal(proof.public.fileCount,1);assert.doesNotMatch(JSON.stringify(proof.public),/SYNTHETIC|source|tmp/);
 writeFileSync(path.join(f.bin,'reader-qwen3-asr'),'tampered');assert.throws(()=>checkedBuild(f.source,snap));writeFileSync(path.join(f.bin,'reader-qwen3-asr'),'SYNTHETIC_GENERATED_BINARY');
 const outside=path.join(f.dir,'outside');writeFileSync(outside,'SYNTHETIC_PRIVATE_CHECKOUT');symlinkSync(outside,path.join(f.bin,'escape.so'));f.build.files['escape.so']=digest(readFileSync(outside));writeFileSync(path.join(f.bin,'../reader-build.json'),JSON.stringify(f.build));assert.throws(()=>checkedBuild(f.source,snap));
 }finally{f.cleanup();}
});
test('renamed, duplicate or unapproved upstream mappings fail before initialization even when committed cleanly',()=>{
 for(const text of ['[submodule "renamed"]\n path = third_party/llama.cpp-upstream\n url = https://example.invalid/unapproved.git\n','[submodule "third_party/llama.cpp-upstream"]\n path = third_party/llama.cpp-upstream\n url = https://example.invalid/unapproved.git\n','[submodule "third_party/llama.cpp-upstream"]\n path = third_party/llama.cpp-upstream\n url = https://github.com/ggml-org/llama.cpp.git\n[submodule "second"]\n path = third_party/llama.cpp-upstream\n url = https://example.invalid/other.git\n']){
  const f=fixture();try{writeFileSync(path.join(f.source,'.gitmodules'),text);execFileSync('git',['add','.gitmodules'],{cwd:f.source});execFileSync('git',['-c','core.hooksPath=/dev/null','commit','-qm','synthetic mapping','--no-gpg-sign'],{cwd:f.source});assert.throws(()=>snapshot(f.source));}finally{f.cleanup();}
 }
});
test('actual seal/receipt commands encrypt generated bundle and never upload a checkout or plaintext',()=>{
 const f=fixture();try{
 const publicDir=path.join(f.dir,'ci');mkdirSync(publicDir);for(const file of ['llama-cpu-run.mjs','llama-cpu-verification.mjs','reader-verification.mjs','log-crypto.mjs'])copyFileSync(new URL(file,import.meta.url),path.join(publicDir,file));
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});writeFileSync(path.join(publicDir,'build-logs-public.pem'),keys.publicKey);
 const output=path.join(f.dir,'llama-cpu-output');mkdirSync(output);const snap=snapshot(f.source),v={...value,tested:snap.head};const s={...summary(),binding:v,sourceBefore:snap,sourceAfter:snap};writeFileSync(path.join(output,'private-summary.json'),JSON.stringify(s));writeFileSync(path.join(f.dir,'reader-private-build.log'),'SYNTHETIC_PRIVATE_LOG');
 const env={...process.env,VERIFICATION_BINDING:JSON.stringify(v),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',VERIFICATION_SCOPE:'llama-cpu',RUNNER_TEMP:f.dir,VERIFICATION_OUTCOME:'success'};
 const call=command=>spawnSync(process.execPath,[path.join(publicDir,'llama-cpu-run.mjs'),command],{cwd:f.dir,env,encoding:'utf8'});
 assert.equal(call('seal').status,0);const r=call('receipt');assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC_PRIVATE/);const result=JSON.parse(readFileSync(path.join(output,'verification.json')));validateCpuResult(result,v,options);assert.equal(result.status,'PASS');
 const envelope=readFileSync(path.join(output,'diagnostics.enc.json'));assert.equal(result.diagnosticsSha256,digest(envelope));const archive=decryptLog(JSON.parse(envelope),keys.privateKey);writeFileSync(path.join(f.dir,'archive.tar.gz'),archive);const names=execFileSync('tar',['-tzf',path.join(f.dir,'archive.tar.gz')],{encoding:'utf8'});assert(names.includes('reader-qwen3-asr'));assert(names.includes('reader-build.json'));assert(names.includes('reader-private-build.log'));assert(!names.includes('third_party/llama.cpp-upstream/LICENSE'));assert(!names.includes('.git/'));
 writeFileSync(path.join(f.bin,'reader-qwen3-asr'),'tampered');assert.notEqual(call('seal').status,0);writeFileSync(path.join(f.bin,'reader-qwen3-asr'),'SYNTHETIC_GENERATED_BINARY');const after=call('receipt');assert.equal(after.status,0);assert.equal(JSON.parse(readFileSync(path.join(output,'verification.json'))).status,'FAIL');
 }finally{f.cleanup();}
});
test('CPU artifact prefix uses the real bounded ZIP reader and cannot borrow a full artifact',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cpu-zip-test-'));try{
  writeFileSync(path.join(dir,'verification.json'),JSON.stringify(receipt()));execFileSync('zip',['-q','r.zip','verification.json'],{cwd:dir});const bytes=readFileSync(path.join(dir,'r.zip'));
  const row={id:99,name:'reader-llama-cpu-result-123-1',expired:false,workflow_run:{id:123,head_sha:value.workflow},digest:`sha256:${digest(bytes)}`,size_in_bytes:bytes.length};
  const transport=async(url,opts)=>String(url).startsWith('https://api.github.com/')?{status:302,headers:new Headers({location:'https://example.test/signed'})}:{ok:true,body:(async function*(){assert.equal(opts.headers,undefined);yield bytes;})()};
  const r=await readReceipt(async()=>({artifacts:[row]}),value,123,1,'TOKEN',transport,{prefix:'reader-llama-cpu-result'});validateCpuResult(r,value,options);
  await assert.rejects(readReceipt(async()=>({artifacts:[row]}),value,123,1,'TOKEN',transport));
  await assert.rejects(readReceipt(async()=>({artifacts:[{...row,name:'reader-full-result-123-1'}]}),value,123,1,'TOKEN',transport,{prefix:'reader-llama-cpu-result'}));
  await assert.rejects(readReceipt(async()=>assert.fail(),value,123,1,'TOKEN',transport,{prefix:'other'}));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('workflow isolates CPU credentials/results, keeps the full graph and makes focused scope explicit',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8');const cpu=yaml.split('\n  llama-cpu:')[1].split('\n  report-llama-cpu:')[0];
 assert(!cpu.includes('READER_VERIFICATION_TOKEN'));assert(cpu.includes('persist-credentials: false'));assert(cpu.includes('retention-days: 7'));assert(cpu.includes('if-no-files-found: error'));assert(!/path:.*(?:\.llama-build|source\/)/.test(cpu));
 assert(yaml.includes("full:\n    if: inputs.scope != 'llama-cpu'"));assert(yaml.includes('Run the unchanged complete task graph'));assert(yaml.includes('reader-full-result-'));assert(yaml.includes('reader-llama-cpu-result-'));assert(yaml.includes('options: [full, llama-cpu]'));
});
