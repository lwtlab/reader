import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync,existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {binding,digest,positive} from './reader-verification.mjs';
import {CPU_TASKS,CPU_CONTRACT,cpuResult,validateCpuResult,scope} from './llama-cpu-verification.mjs';
import {encryptLog} from './log-crypto.mjs';
import {readCpuPlan,validateCpuPlan,cpuCoverage,catalogResult,loadCpuExecutor,validateCpuExecution,verifyCpuExecutorGraph} from './cpu-catalog.mjs';

export function snapshot(source,run=execFileSync){const git=args=>run('git',args,{cwd:source,encoding:'utf8',timeout:10000});
  const upstream='third_party/llama.cpp-upstream',key=`submodule.${upstream}`;
  const paths=git(['config','--null','--file','.gitmodules','--get-regexp','^submodule\\..*\\.path$']).split('\0').filter(Boolean).map(row=>{const split=row.indexOf('\n');assert(split>0);return [row.slice(0,split),row.slice(split+1)];});
  assert.deepEqual(paths.filter(([,value])=>value===upstream),[[key+'.path',upstream]],'Only the approved unique upstream submodule name/path is accepted');
  assert.deepEqual(git(['config','--null','--file','.gitmodules','--get-all',key+'.url']).split('\0').filter(Boolean),['https://github.com/ggml-org/llama.cpp.git']);
  const entry=git(['ls-files','--stage','--','third_party/llama.cpp-upstream']).trim();assert.match(entry,/^160000 [a-f0-9]{40} 0\tthird_party\/llama.cpp-upstream$/);return {head:git(['rev-parse','HEAD']).trim(),dirty:git(['status','--porcelain']).trim()!=='',upstreamRevision:entry.split(/\s+/)[1]};}
export async function executeTasks(summary,source,log,{execute,now=Date.now,persist=()=>{},catalogPlan}={}) {
  const definitions=catalogPlan?validateCpuPlan(catalogPlan).tasks:CPU_TASKS;
  execute??=command=>new Promise((resolve,reject)=>{const child=spawn(command[0],command.slice(1),{cwd:source,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{try{log(chunk)}catch{child.kill('SIGTERM');reject(new Error('Private log capacity/write failure'))}});child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  for(let index=0;index<definitions.length;index++){
    const task=summary.tasks[index];assert.equal(task.id,definitions[index].id);assert.equal(task.status,'NOT_RUN');const start=now();console.log(`CPU ${task.id}: RUNNING`);
    try{for(const command of definitions[index].commands){const result=await execute(command);assert.equal(result.code,0);assert(!result.signal);}task.status='PASS';task.exitCode=0;}
    catch(error){task.status='FAIL';task.exitCode=1;log(Buffer.from(String(error)+'\n'));}
    task.durationMs=Math.max(0,now()-start);if(catalogPlan)summary.catalogExecution=cpuCoverage(catalogPlan,summary.tasks);persist(summary);console.log(`CPU ${task.id}: ${task.status}`);if(task.status==='FAIL')return false;
  }
  return true;
}
export async function executeOwnedCpu(summary,source,log,{persist=()=>{},signal,load=loadCpuExecutor}={}) {
  const plan=validateCpuPlan(summary.catalogPlan);
  assert(summary.tasks.every(task=>task.status==='NOT_RUN'));
  const execute=await load(source);
  const report=await execute({root:source,contract:plan,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},signal,output:log,onResult:task=>{
    const index=summary.tasks.findIndex(existing=>existing.id===task.id);assert(index>=0);
    summary.tasks[index]=task;summary.catalogExecution=cpuCoverage(plan,summary.tasks);persist(summary);
    console.log(`CPU ${task.id}: ${task.status}`);
  }});
  validateCpuExecution(report,plan,summary.tasks);
  summary.cpuExecutor=report;persist(summary);
  return report.catalogExecution.status==='PASS'&&!signal?.aborted;
}
export function checkedBuild(source,expected){
  const directory=path.join(source,'.llama-build/upstream-cpu'),manifest=path.join(directory,'reader-build.json');assert(!lstatSync(directory).isSymbolicLink());const buildRoot=realpathSync(directory);assert(buildRoot.startsWith(realpathSync(source)+path.sep));assert(!lstatSync(manifest).isSymbolicLink());const bytes=readFileSync(manifest),record=JSON.parse(bytes);assert.equal(record.runtime,'upstream-asr');assert.equal(record.backend,'cpu');assert.equal(record.platform,'linux');assert.equal(record.arch,'x64');assert.equal(record.revision,expected.upstreamRevision);
  const upstream=path.join(source,'third_party/llama.cpp-upstream');assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim(),expected.upstreamRevision);assert.equal(execFileSync('git',['status','--porcelain'],{cwd:upstream,encoding:'utf8'}).trim(),'');
  const license=path.join(directory,'LICENSE.llama.cpp');assert(!lstatSync(license).isSymbolicLink());assert.equal(digest(readFileSync(license)),digest(readFileSync(path.join(upstream,'LICENSE'))));
  const bin=path.join(directory,'bin');assert(!lstatSync(bin).isSymbolicLink());const root=realpathSync(bin),names=Object.keys(record.files);assert(names.length>=1&&names.length<=64);assert(names.includes('reader-qwen3-asr'));let size=0;const files=[manifest,path.join(directory,'LICENSE.llama.cpp')];
  for(const name of names){assert.match(name,/^[A-Za-z0-9_.-]{1,128}$/);const candidate=path.join(root,name),actual=realpathSync(candidate);assert(actual.startsWith(root+path.sep));const info=statSync(actual);assert(info.isFile());size+=info.size;assert(size<=256*1024*1024);assert.equal(digest(readFileSync(actual)),record.files[name]);files.push(candidate);}
  return {public:{upstreamRevision:record.revision,manifestSha256:digest(bytes),runtimeSha256:record.files['reader-qwen3-asr'],bundleSha256:digest(JSON.stringify(Object.fromEntries(names.sort().map(n=>[n,record.files[n]])))),fileCount:names.length},files};
}
async function main(){
  const root=process.cwd(),source=path.join(root,'source'),output=path.join(root,'llama-cpu-output');mkdirSync(output,{recursive:true,mode:0o700});const state=path.join(output,'private-summary.json'),log=path.join(process.env.RUNNER_TEMP,'reader-private-build.log');
  const value=binding(JSON.parse(process.env.VERIFICATION_BINDING)),run=positive(process.env.GITHUB_RUN_ID),attempt=positive(process.env.GITHUB_RUN_ATTEMPT),mode=scope(process.env.VERIFICATION_SCOPE||'full');const operation=process.argv[2];
  assert([undefined,'true'].includes(process.env.CPU_CATALOG));const catalogMode=process.env.CPU_CATALOG==='true';if(catalogMode){assert.equal(process.platform,'linux');assert.equal(mode,'llama-cpu');}
  const load=()=>JSON.parse(readFileSync(state));const save=s=>writeFileSync(state,JSON.stringify(s,null,2),{mode:0o600});
  const append=chunk=>{const size=existsSync(log)?statSync(log).size:0;assert(size+chunk.length<=256*1024*1024);appendFileSync(log,chunk,{mode:0o600});};
  if(catalogMode&&['identity','verify'].includes(operation))verifyCpuExecutorGraph(source);
  if(operation==='identity'){assert(!existsSync(state));const before=snapshot(source);assert.equal(before.head,value.tested);assert.equal(before.dirty,false);const summary={executionRunId:randomUUID(),binding:value,run,attempt,scope:mode,contract:CPU_CONTRACT,sourceBefore:before,tasks:CPU_TASKS.map(t=>({id:t.id,status:'NOT_RUN',exitCode:null,durationMs:null}))};if(catalogMode){summary.catalogPlan=readCpuPlan(source);summary.catalogExecution=cpuCoverage(summary.catalogPlan,summary.tasks);}save(summary);console.log('Exact clean CPU input accepted');return;}
  if(operation==='verify'){
    const summary=load();assert.deepEqual(snapshot(source),summary.sourceBefore);if(catalogMode)assert.deepEqual(readCpuPlan(source),summary.catalogPlan);
    const controller=new AbortController(),interrupt=()=>controller.abort();
    if(catalogMode){process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);}
    try {
      const passed=catalogMode?await executeOwnedCpu(summary,source,append,{persist:save,signal:controller.signal}):await executeTasks(summary,source,append,{persist:save});
      summary.sourceAfter=snapshot(source);save(summary);if(!passed)process.exitCode=controller.signal.aborted?130:1;
    } finally {if(catalogMode){process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}}
    return;
  }
  if(operation==='seal'){
    const encrypted=path.join(output,'diagnostics.enc.json'),sealed=path.join(output,'sealed-build.json');rmSync(encrypted,{force:true});rmSync(sealed,{force:true});
    const files=[];if(existsSync(log))files.push(log);if(existsSync(state))files.push(state);
    let summary,build=null;try{summary=load();}catch{}
    const summarySha256=catalogMode&&existsSync(state)?digest(readFileSync(state)):null;
    if(summary?.tasks.every(t=>t.status==='PASS')){build=checkedBuild(source,summary.sourceBefore);files.push(...build.files);}
    assert(files.length>0);let total=0;for(const file of files){const stat=statSync(file);assert(stat.isFile());total+=stat.size;assert(total<=256*1024*1024);}
    const archive=path.join(process.env.RUNNER_TEMP,'reader-llama-cpu.tar.gz');try{execFileSync('tar',['-chzf',archive,'--null','-T','-'],{input:Buffer.from(files.join('\0')+'\0'),stdio:['pipe','pipe','pipe'],timeout:60000});if(build)assert.deepEqual(checkedBuild(source,summary.sourceBefore).public,build.public);if(catalogMode&&summarySha256)assert.equal(digest(readFileSync(state)),summarySha256);writeFileSync(encrypted,JSON.stringify(encryptLog(readFileSync(archive),readFileSync(new URL('./build-logs-public.pem',import.meta.url)))),{mode:0o600});writeFileSync(sealed,JSON.stringify({build:build?.public??null,diagnosticsSha256:digest(readFileSync(encrypted)),...(catalogMode?{summarySha256}:{})}),{mode:0o600});console.log('CPU diagnostics and generated binaries encrypted');}finally{rmSync(archive,{force:true});}return;
  }
  if(operation==='receipt'){
    let summary,bytes,build=null;try{bytes=readFileSync(state);summary=JSON.parse(bytes);assert.deepEqual(snapshot(source),summary.sourceAfter);const proof=checkedBuild(source,summary.sourceBefore).public,sealed=JSON.parse(readFileSync(path.join(output,'sealed-build.json')));assert.deepEqual(proof,sealed.build);assert.equal(digest(readFileSync(path.join(output,'diagnostics.enc.json'))),sealed.diagnosticsSha256);if(catalogMode)assert.equal(digest(bytes),sealed.summarySha256);build=proof;}catch{}
    const encrypted=path.join(output,'diagnostics.enc.json');const result=cpuResult(summary,value,{run,attempt,mode,execution:process.env.VERIFICATION_OUTCOME,build,diagnostics:existsSync(encrypted)?digest(readFileSync(encrypted)):null,bytes});validateCpuResult(result,value,{run,attempt,mode});const legacyBytes=Buffer.from(JSON.stringify(result,null,2)+'\n');writeFileSync(path.join(output,'verification.json'),legacyBytes,{mode:0o600});if(catalogMode)writeFileSync(path.join(output,'catalog.json'),JSON.stringify(catalogResult(summary,result,bytes,legacyBytes,value,{run,attempt,execution:process.env.VERIFICATION_OUTCOME}),null,2),{mode:0o600});console.log(`CPU receipt: ${result.status}; ${result.tasks.filter(t=>t.status==='PASS').length}/9 tasks`);return;
  }
  if(operation==='require-catalog')assert(catalogMode,'Catalog qualification requires explicit catalog mode');
  assert(['require','require-catalog'].includes(operation));const legacyBytes=readFileSync(path.join(output,'verification.json')),result=JSON.parse(legacyBytes);validateCpuResult(result,value,{run,attempt,mode});assert.equal(result.status,'PASS');
  if(catalogMode){const bytes=readFileSync(state),summary=JSON.parse(bytes);assert.deepEqual(snapshot(source),summary.sourceAfter);assert.deepEqual(checkedBuild(source,summary.sourceBefore).public,result.build);assert.equal(digest(readFileSync(path.join(output,'diagnostics.enc.json'))),result.diagnosticsSha256);assert.equal(digest(bytes),JSON.parse(readFileSync(path.join(output,'sealed-build.json'))).summarySha256);const expected=catalogResult(summary,result,bytes,legacyBytes,value,{run,attempt,execution:process.env.VERIFICATION_OUTCOME});assert.deepEqual(JSON.parse(readFileSync(path.join(output,'catalog.json'))),expected);assert.equal(expected.status,'PASS');}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('CPU verification failed; no private output is printed');process.exitCode=1});
