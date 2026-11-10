import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {binding,resultFromSummary,validateResult} from './reader-verification.mjs';
import {encryptLog} from './log-crypto.mjs';

const root=process.cwd(),source=path.join(root,'source'),output=path.join(root,'verification-output');
function checkSource(value) {
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),value.tested);
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).trim(),'');
}
function receipt() {
  const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));
  const directory=path.join(source,'.artifacts/verify');
  const reports=existsSync(directory)?readdirSync(directory).filter(name=>/^[a-f0-9-]{36}$/.test(name)).map(name=>path.join(directory,name,'summary.json')).filter(existsSync):[];
  // A fresh hosted checkout has exactly one real execution, never a selected old PASS.
  let bytes,summary;
  if(reports.length===1){bytes=readFileSync(reports[0]);try{summary=JSON.parse(bytes);}catch{}}
  const result=resultFromSummary(summary,value,process.env.VERIFICATION_OUTCOME,bytes);
  validateResult(result,value);
  mkdirSync(output,{recursive:true,mode:0o700});
  writeFileSync(path.join(output,'verification.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(`Full verification: ${result.status}; ${result.tasks.filter(t=>t.status==='PASS').length}/33 tasks`);
}
function seal() {
  mkdirSync(output,{recursive:true,mode:0o700});
  const log=path.join(process.env.RUNNER_TEMP,'reader-private-build.log');
  // Archive only explicit synthetic verification locations. No checkout, env, credentials or packages.
  const roots=[path.join(source,'.artifacts/verify'),path.join(source,'apps/reader/test-results')];
  const files=[];let total=0;
  function visit(file) {
    const info=lstatSync(file);assert(!info.isSymbolicLink(),'Diagnostic links are forbidden');
    if(info.isDirectory())for(const name of readdirSync(file))visit(path.join(file,name));
    else {assert(info.isFile());files.push(file);total+=info.size;assert(files.length<=20000&&total<=256*1024*1024,'Diagnostics exceed bounded retention');}
  }
  for(const file of roots)if(existsSync(file))visit(file);
  if(existsSync(log))visit(log);
  const archive=path.join(process.env.RUNNER_TEMP,'reader-verification-diagnostics.tar.gz');
  try {
    if(!files.length)return;
    execFileSync('tar',['-czf',archive,'--null','-T','-'],{input:Buffer.from(files.join('\0')+'\0'),stdio:['pipe','pipe','pipe'],timeout:60000});
    const key=readFileSync(new URL('./build-logs-public.pem',import.meta.url));
    writeFileSync(path.join(output,'diagnostics.enc.json'),JSON.stringify(encryptLog(readFileSync(archive),key)),{mode:0o600});
    console.log('Synthetic diagnostics encrypted; no plaintext diagnostic artifact is uploaded');
  } finally {rmSync(archive,{force:true});if(existsSync(log))rmSync(log);}
}
try {
  const command=process.argv[2];
  if(command==='identity') {checkSource(binding(JSON.parse(process.env.VERIFICATION_BINDING)));console.log('Exact clean source checkout verified');}
  else if(command==='receipt')receipt();
  else if(command==='seal')seal();
  else if(command==='require') {const result=JSON.parse(readFileSync(path.join(output,'verification.json')));validateResult(result,binding(JSON.parse(process.env.VERIFICATION_BINDING)));assert.equal(result.status,'PASS');}
  else throw new Error('Unknown verification operation');
} catch {console.error('Verification operation failed; no success evidence produced');process.exitCode=1;}
