import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {binding,digest,positive} from './reader-verification.mjs';
import {profiles,profile,contract,result,validateResult} from './reader-reliability-verification.mjs';
import {encryptLog} from './log-crypto.mjs';

export function snapshot(source){const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});return {head:git(['rev-parse','HEAD']).trim(),dirty:git(['status','--porcelain','--untracked-files=all']).trim()!==''};}
export async function executeTasks(summary,source,append,save){
  for(const task of profiles[summary.profile].tasks){
    const state=summary.tasks.find(t=>t.id===task.id),started=Date.now();
    assert.equal(state.status,'NOT_RUN');
    const env={...process.env,CI:'1',LWT_VERIFY_ARTIFACTS_DIR:path.join(source,'.artifacts/public-reliability')};
    delete env.GH_TOKEN;delete env.GITHUB_TOKEN;
    for(const key of Object.keys(env))if(key.startsWith('READER_RELIABILITY_SOAK'))delete env[key];
    // The public soak is always two hours at normal speed; dispatch cannot shorten it.
    Object.assign(env,{READER_RELIABILITY_SOAK_SECONDS:'7200',READER_RELIABILITY_SOAK_PLAYBACK_RATE:'1',READER_RELIABILITY_SOAK_MEDIA_SECONDS:'90'});
    console.log(`Reliability ${task.id}: RUNNING`);
    try{
      await new Promise((resolve,reject)=>{
        const child=spawn(task.command[0],task.command.slice(1),{cwd:path.join(source,'apps/reader'),env,stdio:['ignore','pipe','pipe']});
        for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{try{append(chunk);}catch{child.kill('SIGTERM');reject(new Error('Private log write failed'));}});
        child.once('error',reject);child.once('close',(code,signal)=>code===0&&!signal?resolve():reject(new Error('Verification command failed')));
      });
      state.status='PASS';state.exitCode=0;
    }catch{state.status='FAIL';state.exitCode=1;}
    state.durationMs=Date.now()-started;save(summary);console.log(`Reliability ${task.id}: ${state.status}`);
    if(state.status!=='PASS')return false;
  }
  return true;
}
async function main(){
  const root=process.cwd(),source=path.join(root,'source'),output=path.join(root,'reliability-output');
  mkdirSync(output,{recursive:true,mode:0o700});
  const state=path.join(output,'private-summary.json'),log=path.join(process.env.RUNNER_TEMP,'reader-private-build.log');
  const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));
  const options={profile:profile(process.env.RELIABILITY_PROFILE),run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT)};
  const load=()=>JSON.parse(readFileSync(state));
  const save=s=>writeFileSync(state,JSON.stringify(s,null,2)+'\n',{mode:0o600});
  const check=s=>{assert.deepEqual(s.binding,value);for(const k of ['profile','run','attempt'])assert.equal(s[k],options[k]);assert.equal(s.contractSha256,contract(options.profile));};
  const append=chunk=>{assert((existsSync(log)?statSync(log).size:0)+chunk.length<=256*1024*1024);appendFileSync(log,chunk,{mode:0o600});};
  const command=process.argv[2];
  if(command==='identity'){
    assert(!existsSync(state));const before=snapshot(source);assert.equal(before.head,value.tested);assert.equal(before.dirty,false);
    save({executionRunId:randomUUID(),binding:value,...options,contractSha256:contract(options.profile),sourceBefore:before,tasks:profiles[options.profile].tasks.map(t=>({id:t.id,status:'NOT_RUN',exitCode:null,durationMs:null}))});console.log('Exact clean reliability source accepted');return;
  }
  if(command==='verify'){
    const summary=load();check(summary);assert.deepEqual(snapshot(source),summary.sourceBefore);
    const passed=await executeTasks(summary,source,append,save);summary.sourceAfter=snapshot(source);save(summary);
    if(!passed||JSON.stringify(summary.sourceBefore)!==JSON.stringify(summary.sourceAfter))process.exitCode=1;return;
  }
  if(command==='seal'){
    rmSync(path.join(output,'diagnostics.enc.json'),{force:true});
    const files=[];let total=0;
    function visit(file){const info=lstatSync(file);assert(!info.isSymbolicLink(),'Diagnostic links forbidden');if(info.isDirectory())for(const name of readdirSync(file))visit(path.join(file,name));else{assert(info.isFile());files.push(file);total+=info.size;assert(files.length<=20000&&total<=256*1024*1024);}}
    for(const file of [state,log,path.join(source,'.artifacts/public-reliability'),path.join(source,'apps/reader/test-results'),path.join(source,'apps/reader/reliability-results')])if(existsSync(file))visit(file);
    assert(files.length>0);const archive=path.join(process.env.RUNNER_TEMP,`reader-reliability-${options.run}-${options.attempt}.tar.gz`);
    try{execFileSync('tar',['-czf',archive,'--null','-T','-'],{input:Buffer.from(files.join('\0')+'\0'),stdio:['pipe','pipe','pipe'],timeout:60000});writeFileSync(path.join(output,'diagnostics.enc.json'),JSON.stringify(encryptLog(readFileSync(archive),readFileSync(new URL('./build-logs-public.pem',import.meta.url)))),{mode:0o600});console.log('Reliability diagnostics encrypted');}finally{rmSync(archive,{force:true});}return;
  }
  if(command==='receipt'){
    let summary,bytes;try{bytes=readFileSync(state);summary=JSON.parse(bytes);check(summary);assert.deepEqual(snapshot(source),summary.sourceAfter);}catch{summary=null;}
    const sealed=path.join(output,'diagnostics.enc.json');
    const receipt=result(summary,value,{...options,execution:process.env.VERIFICATION_OUTCOME,bytes,diagnostics:existsSync(sealed)?digest(readFileSync(sealed)):null});validateResult(receipt,value,options);
    writeFileSync(path.join(output,'verification.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(`Reliability receipt: ${receipt.status}`);return;
  }
  assert.equal(command,'require');const receipt=JSON.parse(readFileSync(path.join(output,'verification.json')));validateResult(receipt,value,options);assert.equal(receipt.status,'PASS');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Reliability operation failed; private output remains in encrypted diagnostics');process.exitCode=1;});
