// Fixed synthetic GUI investigation; never reports a source/release gate.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,existsSync,readdirSync,appendFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {binding,digest,positive} from './reader-verification.mjs';
import {github} from './reader-verification-control.mjs';
import {MANIFEST,exampleFor,resolveSelected} from './selected-input.mjs';
import {IMPLEMENTATION} from './selected-contract.mjs';
import {verifyImplementation} from './shadow-plan.mjs';
import {encryptLog} from './log-crypto.mjs';
const BRANCH='ci/selected-gui-diagnostic-20261113',pins=JSON.parse(readFileSync(new URL('./gui-diagnostic-pins.json',import.meta.url)));
const caseHashes=JSON.parse(readFileSync(new URL('./gui-diagnostic-cases.json',import.meta.url)));
export function validateFocusedReport(bytes,expectedTitles=caseHashes){
 assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<16*1024*1024);assert.equal(expectedTitles.length,3);assert.equal(new Set(expectedTitles).size,3);
 const report=JSON.parse(bytes);assert.equal(report.config.workers,1);assert.equal(report.config.projects.length,1);const project=report.config.projects[0];assert.equal(project.repeatEach,20);assert.equal(project.retries,0);assert.equal(report.suites.length,1);assert.equal(report.suites[0].title,'model-switch.spec.ts');const specs=report.suites[0].specs;assert(specs.length>0&&specs.length<=60);
 // Reporter versions/grouping can combine repeats into one spec or retain separate
 // specs. Qualify actual case/project/result executions, never a synthetic spec count.
 const cases=new Map(expectedTitles.map(hash=>[hash,[]]));
 for(const spec of specs){assert.equal(spec.file,'model-switch.spec.ts');assert.equal(spec.ok,true);const hash=digest(spec.title);assert(cases.has(hash));assert(spec.tests.length>0&&spec.tests.length<=20);
  for(const test of spec.tests){assert.equal(test.expectedStatus,'passed');assert.equal(test.status,'expected');assert.equal(test.projectId,project.id);assert.equal(test.projectName,project.name);assert.equal(test.results.length,1);const r=test.results[0];assert.equal(r.retry,0);assert.equal(r.status,'passed');assert.deepEqual(r.errors,[]);assert(Number.isSafeInteger(r.workerIndex)&&r.workerIndex>=0);assert.equal(r.parallelIndex,0);cases.get(hash).push(r.workerIndex);}
 }
 let workers;for(const rows of cases.values()){assert.equal(rows.length,20);assert.equal(new Set(rows).size,20);const current=[...rows].sort((a,b)=>a-b);if(workers)assert.deepEqual(current,workers);else workers=current;}
 assert.deepEqual({expected:report.stats.expected,unexpected:report.stats.unexpected,skipped:report.stats.skipped,flaky:report.stats.flaky},{expected:60,unexpected:0,skipped:0,flaky:0});return {passed:60,failed:0,skipped:0,repeats:20};
}
function current(){assert.equal(process.env.GITHUB_REPOSITORY,'lwtlab/reader');assert.equal(process.env.GITHUB_REF,`refs/heads/${BRANCH}`);const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));assert.equal(value.workflow,process.env.GITHUB_SHA);const e=exampleFor('unknown');assert.equal(value.head,e.head);assert.equal(value.base,e.base);assert.equal(value.pr,e.pr);return {value,run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT)};}
function identity(value){const source=resolve('source');verifyImplementation(source,{...IMPLEMENTATION.implementation,...pins});const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',timeout:30000}).trim();assert.equal(git('rev-parse','HEAD'),value.tested);assert.equal(git('status','--porcelain'),'');assert.equal(git('show','-s','--format=%P','HEAD'),`${value.base} ${value.head}`);return source;}
function ordinary(file,limit){const s=lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=limit);assert.equal(realpathSync(file),resolve(file));return readFileSync(file);}
function collect(){
 const {value,run,attempt}=current(),source=resolve('source'),output=resolve('gui-diagnostic-output');mkdirSync(output,{recursive:true,mode:0o700});let counts=null,sourceValid=false;
 try{identity(value);sourceValid=true;counts=validateFocusedReport(ordinary(join(process.env.RUNNER_TEMP,'hear-focused-results.json'),16*1024*1024));}catch{}
 const files=[];let size=0;const visit=file=>{if(!existsSync(file))return;const info=lstatSync(file);assert(!info.isSymbolicLink());if(info.isDirectory()){for(const name of readdirSync(file))visit(join(file,name));}else{assert(info.isFile());files.push(file);size+=info.size;assert(files.length<=10000&&size<=128*1024*1024);}};
 for(const file of [join(process.env.RUNNER_TEMP,'hear-focused-results.json'),join(process.env.RUNNER_TEMP,'reader-private-build.log'),join(source,'apps/hear/apps/desktop/test-results')])visit(file);
 assert(files.length>0);const archive=join(process.env.RUNNER_TEMP,'focused-gui-diagnostics.tar.gz');execFileSync('tar',['-czf',archive,'--null','-T','-'],{input:Buffer.from(files.join('\0')+'\0'),stdio:['pipe','pipe','pipe'],timeout:60000});const bytes=ordinary(archive,128*1024*1024);rmSync(archive);const envelope=Buffer.from(JSON.stringify(encryptLog(bytes,readFileSync(new URL('./build-logs-public.pem',import.meta.url)))));writeFileSync(join(output,'diagnostics.enc.json'),envelope,{flag:'wx',mode:0o600});
 const result={schemaVersion:1,kind:'hear-focused-gui-diagnostic',binding:value,run,attempt,status:'NOT_QUALIFIED',sourceIdentity:sourceValid?'PASS':'FAIL',execution:process.env.GUI_DIAGNOSTIC_OUTCOME??'unknown',controls:sourceValid&&counts&&process.env.GUI_DIAGNOSTIC_OUTCOME==='success'?'PASS':'FAIL',tests:counts??{passed:null,failed:null,skipped:null,repeats:20},encryptedDiagnosticsSha256:digest(envelope),acceptance:{selectedSourceGate:'NOT_RUN',readerFull33:'NOT_RUN',hearNative7:'NOT_RUN',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'}};
 writeFileSync(join(output,'diagnostic.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(`Focused GUI controls ${result.controls}; no source or release gate receipt`);
}
async function main(){assert.equal(process.argv.length,3);const mode=process.argv[2];if(mode==='resolve'){
 assert.equal(process.env.GITHUB_REPOSITORY,'lwtlab/reader');assert.equal(process.env.GITHUB_REF,`refs/heads/${BRANCH}`);assert.equal(process.env.WORKFLOW_SHA,process.env.GITHUB_SHA);const e=exampleFor('unknown');assert.equal(process.env.SOURCE_REF,e.head);assert.equal(Number(process.env.PR_NUMBER),e.pr);const value=await resolveSelected(github(process.env.GH_TOKEN),'unknown',process.env.GITHUB_SHA,MANIFEST);appendFileSync(process.env.GITHUB_OUTPUT,`binding=${JSON.stringify(value)}\ntested=${value.tested}\n`);return;
 }const {value,run,attempt}=current();if(mode==='identity'){identity(value);return;}if(mode==='collect'){collect();return;}assert.equal(mode,'require');const r=JSON.parse(ordinary('gui-diagnostic-output/diagnostic.json',65536));assert.equal(r.schemaVersion,1);assert.equal(r.kind,'hear-focused-gui-diagnostic');assert.equal(r.run,run);assert.equal(r.attempt,attempt);assert.equal(r.status,'NOT_QUALIFIED');assert.equal(r.controls,'PASS');assert.equal(r.sourceIdentity,'PASS');assert.equal(r.execution,'success');assert.equal(r.tests.passed,60);assert.equal(r.tests.repeats,20);assert.deepEqual(r.acceptance,{selectedSourceGate:'NOT_RUN',readerFull33:'NOT_RUN',hearNative7:'NOT_RUN',modelInference:'NOT_RUN',signedInstallation:'NOT_RUN',physicalAudio:'NOT_RUN'});assert.deepEqual(r.binding,value);assert.equal(digest(ordinary('gui-diagnostic-output/diagnostics.enc.json',192*1024*1024)),r.encryptedDiagnosticsSha256);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Focused GUI diagnostic failed; inspect encrypted artifacts');process.exitCode=1;});
