import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {binding,digest,positive} from './reader-verification.mjs';
import {snapshot} from './llama-cpu-run.mjs';
import {MATRIX,STEPS,CONTRACT,validatePlatform} from './reader-native-tts-verification.mjs';
import {encryptLog} from './log-crypto.mjs';

export function commands(matrix,build) {
  return [
    ['source','git','-c','submodule.third_party/llama.cpp-upstream.url=https://github.com/ggml-org/llama.cpp.git','submodule','update','--init','--','third_party/llama.cpp-upstream'],
    ['source','bash','apps/reader/scripts/install.sh','--frozen-lockfile'],
    ['source/apps/reader','pnpm','exec','vitest','run','lib/tts/local-runtime/bundle.test.ts','lib/tts/local-runtime/runtime.test.ts'],
    ['source/apps/reader','node','--test','scripts/local-tts-package.test.mjs'],
    ['source','python','-B','scripts/test_reader_tts_runtime_package.py'],
    ['source','node','scripts/build-reader-local-tts.mjs','--backend',matrix.backend,'--jobs','3','--output',build],
    ['source',path.join(build,'bin',`reader-qwen3-tts${matrix.platform==='win32'?'.exe':''}`),'--help'],
  ];
}
export async function executeSteps(summary,sequence,{execute,log,save,now=Date.now}) {
  for(let i=0;i<STEPS.length;i++){
    const row=summary.steps[i],start=now();assert.equal(row.id,STEPS[i]);assert.equal(row.status,'NOT_RUN');
    console.log(`Native ${row.id}: RUNNING`);
    try {const result=await execute(sequence[i]);assert.equal(result.code,0);assert(!result.signal);row.status='PASS';}
    catch(error){row.status='FAIL';log(Buffer.from(String(error)+'\n'));}
    row.durationMs=Math.max(0,now()-start);save(summary);console.log(`Native ${row.id}: ${row.status}`);if(row.status==='FAIL')return false;
  }
  return true;
}
export function checkedBuild(build,matrix,source,before) {
  const file=path.join(build,'reader-tts-build.json'),bytes=readFileSync(file),record=JSON.parse(bytes);
  assert.equal(record.schemaVersion,2);for(const k of ['platform','arch','backend'])assert.equal(record[k],matrix[k]);assert.equal(record.upstreamRevision,before.upstreamRevision);
  const upstream=path.join(source,'third_party/llama.cpp-upstream');assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim(),before.upstreamRevision);assert.equal(execFileSync('git',['status','--porcelain'],{cwd:upstream,encoding:'utf8'}).trim(),'');
  const prefix=realpathSync(path.join(build,'bin'))+path.sep;
  const check=(f,h)=>{const actual=realpathSync(f);assert(actual.startsWith(prefix));assert(statSync(actual).isFile());assert(statSync(actual).size<=256*1024*1024);assert.equal(digest(readFileSync(actual)),h);};
  check(record.binary,record.binarySha256);assert.equal(path.basename(record.binary),`reader-qwen3-tts${matrix.platform==='win32'?'.exe':''}`);
  assert(record.libraries.length<=64);for(const lib of record.libraries)check(lib.file,lib.sha256);
  for(const f of ['native/qwen3-tts/main.cpp','native/qwen3-tts/CMakeLists.txt'])assert.equal(record.sourceFiles[f],digest(readFileSync(path.join(source,f))));
  return {upstreamRevision:record.upstreamRevision,manifestSha256:digest(bytes),binarySha256:record.binarySha256,librariesSha256:digest(JSON.stringify(record.libraries.map(x=>({name:path.basename(x.file),sha256:x.sha256}))))};
}
async function main(){
  const root=process.cwd(),source=path.join(root,'source'),out=path.join(root,'native-tts-output');mkdirSync(out,{recursive:true,mode:0o700});
  const value=binding(JSON.parse(process.env.VERIFICATION_BINDING)),run=positive(process.env.GITHUB_RUN_ID),attempt=positive(process.env.GITHUB_RUN_ATTEMPT),id=process.env.NATIVE_PLATFORM;
  const matrix=MATRIX.find(x=>x.id===id);assert(matrix);const operation=process.argv[2],build=path.resolve(process.env.RUNNER_TEMP,'native-build'),state=path.join(out,'private-summary.json'),logFile=path.join(process.env.RUNNER_TEMP,'reader-private-build.log');
  const load=()=>JSON.parse(readFileSync(state)),save=s=>writeFileSync(state,JSON.stringify(s),{mode:0o600});
  const log=chunk=>{assert((existsSync(logFile)?statSync(logFile).size:0)+chunk.length<=64*1024*1024);appendFileSync(logFile,chunk,{mode:0o600});};
  if(operation==='identity'){
    assert.equal(process.platform,matrix.platform);assert.equal(process.arch,matrix.arch);assert.equal(process.versions.node,'24.22.0');assert(!existsSync(state));
    assert.equal(digest(readFileSync(path.join(source,'scripts/reader-native-tts-contract.mjs'))),digest(readFileSync(new URL('./reader-native-tts-contract.mjs',import.meta.url))));
    const before=snapshot(source);assert.equal(before.head,value.tested);assert.equal(before.dirty,false);
    save({binding:value,run,attempt,id,contract:CONTRACT,host:{platform:process.platform,arch:process.arch,backend:matrix.backend},sourceBefore:before,steps:STEPS.map(id=>({id,status:'NOT_RUN',durationMs:null}))});console.log('Exact clean native input and host accepted');return;
  }
  if(operation==='verify'){
    const summary=load();assert.deepEqual(snapshot(source),summary.sourceBefore);
    const execute=([cwd,command,...args])=>new Promise((resolve,reject)=>{
      const exe=process.platform==='win32'&&command==='bash'?path.join(process.env.ProgramFiles,'Git','bin','bash.exe'):command;
      const child=spawn(exe,args,{cwd:path.resolve(cwd),shell:process.platform==='win32'&&command==='pnpm',stdio:['ignore','pipe','pipe'],env:{...process.env,READER_INSTALL_NETWORK:'direct',PYTHONDONTWRITEBYTECODE:'1'}});
      for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{try{log(chunk)}catch{child.kill();reject(new Error('Private log limit/write failure'));}});
      child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
    });
    const passed=await executeSteps(summary,commands(matrix,build),{execute,log,save});summary.sourceAfter=snapshot(source);save(summary);if(!passed)process.exitCode=1;return;
  }
  if(operation==='receipt'){
    let summary,bytes,proof=null,stable=false;try{bytes=readFileSync(state);summary=JSON.parse(bytes);stable=JSON.stringify(snapshot(source))===JSON.stringify(summary.sourceBefore)&&JSON.stringify(summary.sourceBefore)===JSON.stringify(summary.sourceAfter);proof=checkedBuild(build,matrix,source,summary.sourceBefore);}catch{}
    // Fixed diagnostic allowlist. No source tree, cache, environment, key or user data.
    const members=[];for(const [name,file] of [['private-build.log',logFile],['private-summary.json',state],['reader-tts-build.json',path.join(build,'reader-tts-build.json')]]){
      if(existsSync(file)){assert(statSync(file).isFile());assert(statSync(file).size<=64*1024*1024);const data=readFileSync(file);members.push({name,sha256:digest(data),base64:data.toString('base64')});}
    }
    const plaintext=Buffer.from(JSON.stringify({schemaVersion:1,kind:'reader-native-tts-diagnostics',binding:value,run,attempt,id,members}));assert(plaintext.length<=96*1024*1024);
    const encrypted=Buffer.from(JSON.stringify(encryptLog(gzipSync(plaintext),readFileSync(new URL('./reader-native-tts-logs-public.pem',import.meta.url)))));writeFileSync(path.join(out,'diagnostics.enc.json'),encrypted,{mode:0o600});
    const steps=STEPS.map(id=>summary?.steps.find(t=>t.id===id)??{id,status:'NOT_RUN',durationMs:null});
    const exact=summary&&summary.contract===CONTRACT&&JSON.stringify(summary.binding)===JSON.stringify(value)&&summary.run===run&&summary.attempt===attempt&&summary.id===id&&summary.host.platform===matrix.platform&&summary.host.arch===matrix.arch&&summary.host.backend===matrix.backend;
    const passed=process.env.VERIFICATION_OUTCOME==='success'&&exact&&stable&&proof&&steps.every(t=>t.status==='PASS');
    const result={schemaVersion:1,kind:'reader-native-tts-platform',binding:value,run,attempt,contractSha256:CONTRACT,id,host:summary?.host??{platform:matrix.platform,arch:matrix.arch,backend:matrix.backend},status:passed?'PASS':'FAIL',summarySha256:bytes?digest(bytes):null,diagnosticsSha256:digest(encrypted),build:proof,steps};
    validatePlatform(result,value,{run,attempt,id});writeFileSync(path.join(out,'verification.json'),JSON.stringify(result),{mode:0o600});console.log(`Native receipt: ${result.status}`);return;
  }
  assert.equal(operation,'require');const result=JSON.parse(readFileSync(path.join(out,'verification.json')));validatePlatform(result,value,{run,attempt,id});assert.equal(result.status,'PASS');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Native verification failed; private details are in encrypted diagnostics');process.exitCode=1;});
