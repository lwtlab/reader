import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,realpathSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {aggregate,validatePlan,readerFromBytes,coreFromBytes,validateReader,selectedDescriptor,planFromBytes} from './selected-contract.mjs';
import {fixture,run,attempt,ids} from './selected-fixtures.mjs';
import {resolveSelected,checkExamplePlan,MANIFEST} from './selected-input.mjs';
import {artifactMembers,readSelectedArtifact} from './selected-artifacts.mjs';
import {collectSelected,reportSelected,SELECTED_JOBS,selectedJobOutcomes} from './selected-report.mjs';
import {TASKS,digest,fingerprint} from './reader-verification.mjs';
import {planIdentity} from './shadow-plan.mjs';

function result(f){return aggregate(f.records,f.plan,f.value,run,attempt,f.outcomes,f.bytes);}
function refresh(f){for(const [key,data]of Object.entries(f.records))f.bytes[key]=key==='legacy'?data:data?Buffer.from(key==='cpu'?JSON.stringify(data,null,2)+'\n':JSON.stringify(data)):null;}
test('selected real classes require exact44/30/49 current executions, preserving full33 and all mandatory14',()=>{
 for(const id of ids){const f=fixture(id),r=result(f);assert.equal(r.tasks.filter(t=>t.status==='PASS').length,id==='reader-only'?44:id==='hear-only'?30:49);assert(r.tasks.slice(0,14).every(t=>t.status==='PASS'));assert(r.tasks.filter(t=>!t.selected).every(t=>t.status==='NOT_RUN'));assert(r.releaseGates.every(t=>t.status==='NOT_RUN'));assert.equal(r.acceptance.modelInference,'NOT_RUN');assert.equal(r.acceptance.signedInstallation,'NOT_RUN');assert.equal(r.acceptance.physicalAudio,'NOT_RUN');assert(f.plan.selection.tasks.every(t=>t.status==='NOT_RUN'));assert.equal(r.readerFull,id==='hear-only'?'NOT_RUN':'PASS');if(id==='hear-only'){assert.equal(f.records.legacy,null);assert.equal(f.records.reader.fullExecution,null);}}
});
test('missing, duplicate, reused, foreign or forged component results cannot satisfy selected coverage',()=>{
 const mutations=[f=>f.records.reader.tasks.pop(),f=>f.records.reader.tasks.push(f.records.reader.tasks[0]),f=>f.records.reader.tasks[0].status='REUSED',f=>f.records.reader.run++,f=>f.records.reader.fullExecution.run++,f=>f.records.cpu.attempt++,f=>f.records.catalog.executorContractSha256='0'.repeat(64),f=>f.records.hear.nativeOrigin.clean=false,f=>f.records.hear.acceptance.physicalAudio='PASS',f=>f.records.reader.private='PRIVATE',f=>f.records.hear.tasks[0].output='PRIVATE',f=>f.records.reader.fullExecution=null];
 for(const mutate of mutations){const f=fixture();mutate(f);refresh(f);assert.throws(()=>result(f));}
 for(const status of ['failure','skipped','cancelled',undefined])for(const key of ['plan','reader','cpu','hear']){const f=fixture();f.outcomes[key]=status;assert.throws(()=>result(f));}
 for(const key of ['plan','reader','cpu','catalog','hear','legacy']){const f=fixture();f.bytes[key]=null;assert.throws(()=>result(f));}
 const f=fixture('reader-only');f.records.core=null;refresh(f);assert.throws(()=>result(f));
});
test('CPU catalog binds the original legacy receipt bytes without reserialization',()=>{
 const f=fixture();f.bytes.cpu=Buffer.concat([f.bytes.cpu,Buffer.from(' ')]);assert.throws(()=>result(f));
 const g=fixture();g.bytes.catalog=Buffer.concat([g.bytes.catalog,Buffer.from(' ')]);const r=result(g);assert.equal(r.receipts.catalog,digest(g.bytes.catalog));assert.equal(r.receipts.cpu,g.records.catalog.legacyReceiptSha256);
});
test('plan validation retains canonical assignments and conservative missing/invalid metadata',()=>{
 for(const mutate of [p=>p.selection.tasks[0].status='PASS',p=>p.selection.lanes[1].tasks.pop(),p=>p.selection.mandatoryTasks.pop(),p=>p.selection.products=['reader,hear'],p=>p.binding.tested='e'.repeat(40),p=>p.run++,p=>p.selectionApplied=false,p=>p.private='PRIVATE']){const f=fixture();mutate(f.plan);assert.throws(()=>validatePlan(f.plan,f.value,run,attempt));}
 for(const changeMetadata of ['missing','invalid']){const f=fixture();f.plan.selection=selectedDescriptor({...f.plan.selection,planSha256:f.plan.selection.shadowPlanSha256,changeMetadata});validatePlan(f.plan,f.value,run,attempt);f.plan.selection=selectedDescriptor({...f.plan.selection,planSha256:f.plan.selection.shadowPlanSha256,products:['hear']});assert.throws(()=>validatePlan(f.plan,f.value,run,attempt));}
 assert.throws(()=>planFromBytes(Buffer.from('{}'),fixture().value,run,attempt,{controls:'success',plan:'success'}));
});
test('actual Reader summary rejects source/input drift, reused data, child failure and wrong quick/full policy',()=>{
 for(const id of ['reader-only','hear-only'])for(const mutate of [s=>s.tasks[0].exitCode=17,s=>s.tasks[0].status='NOT_RUN',s=>s.sourceAfter.dirty=true,s=>s.inputsAfter.sha256='0'.repeat(64),s=>s.reusedFrom={},s=>s.invocation='push',s=>s.catalogExecution.tasks.pop(),s=>s.catalogExecution.contractSha256='0'.repeat(64),s=>s.cleanupFailure='PRIVATE']){const f=fixture(id);mutate(f.summary);assert.throws(()=>readerFromBytes(Buffer.from(JSON.stringify(f.summary)),f.records.legacy,f.plan,f.value,{run,attempt,execution:'success',preparationStartedAt:1000}));}
 const f=fixture('hear-only');assert.throws(()=>readerFromBytes(f.summaryBytes,Buffer.from('{}'),f.plan,f.value,{run,attempt,execution:'success',preparationStartedAt:1000}));assert.throws(()=>readerFromBytes(f.summaryBytes,null,f.plan,f.value,{run,attempt,execution:'skipped',preparationStartedAt:1000}));f.records.reader.readerFull='PASS';assert.throws(()=>validateReader(f.records.reader,null,f.plan,f.value,run,attempt));
});
test('core source initialization accepts only pinned clean dependencies and actual positive Rust controls',()=>{
 for(const mutate of [s=>s.sourceAfter.submodules[0].head='0'.repeat(40),s=>s.sourceAfter.submodules[0].dirty=true,s=>s.sourceAfter.submodules.pop(),s=>s.sourceTransition.sourceStable=true,s=>s.tasks[0].exitCode=1,s=>s.tasks[1].status='REUSED',s=>s.identity.run++,s=>s.sourceAfter.head='0'.repeat(40)]){const f=fixture('reader-only');mutate(f.coreSummary);assert.throws(()=>coreFromBytes(Buffer.from(JSON.stringify(f.coreSummary)),f.plan,f.value,{run,attempt,execution:'success'},{passed:1,ignored:0}));}
 const f=fixture('reader-only');assert.throws(()=>coreFromBytes(Buffer.from(JSON.stringify(f.coreSummary)),f.plan,f.value,{run,attempt,execution:'success'},{passed:0,ignored:0}));
});
test('actual input resolver requires reviewed own PR, exact frozen base and ordered merge parents',async()=>{
 const f=fixture('hear-only'),e=f.example;
 const pull={number:e.pr,state:'open',head:{sha:e.head,ref:e.branch,repo:{full_name:'lwtlab/lwt-core'}},base:{ref:e.baseBranch,repo:{full_name:'lwtlab/lwt-core'}},author_association:'OWNER',mergeable:true,merge_commit_sha:f.value.tested};
 const api=async endpoint=>endpoint.includes('/pulls/')?pull:endpoint.includes('/git/ref/')?{object:{sha:e.base}}:{sha:f.value.tested,parents:[{sha:e.base},{sha:e.head}]};
 assert.deepEqual(await resolveSelected(api,f.id,f.value.workflow,f.manifest),f.value);
 for(const mutate of [p=>p.head.sha='f'.repeat(40),p=>p.base.ref='main',p=>p.state='closed',p=>p.author_association='CONTRIBUTOR',p=>p.mergeable=null]){const changed=structuredClone(pull);mutate(changed);await assert.rejects(resolveSelected(endpoint=>endpoint.includes('/pulls/')?changed:api(endpoint),f.id,f.value.workflow,f.manifest));}
 await assert.rejects(resolveSelected(endpoint=>endpoint.includes('/git/commits/')?{sha:f.value.tested,parents:[{sha:e.head},{sha:e.base}]}:api(endpoint),f.id,f.value.workflow,f.manifest));
 const p=structuredClone(f.plan);p.selection.changesSha256='0'.repeat(64);assert.throws(()=>checkExamplePlan(p,f.id,f.manifest));
});
function reporterFixture(id='hear-only'){
 const f=fixture(id),qualification=result(f),writes=[];let status={state:'pending',context:'reader-hear-public/selected',description:`selected pending ${fingerprint(f.value)}`,target_url:`https://github.com/lwtlab/reader/actions/runs/${run}/attempts/${attempt}`};
 const jobs=Object.entries(SELECTED_JOBS).map(([key,name])=>({name,status:'completed',conclusion:key==='hear'&&!f.records.hear?'skipped':'success'}));
 const files={plan:{'plan.json':f.bytes.plan},reader:{'selection.json':f.bytes.reader,...(f.bytes.legacy?{'verification.json':f.bytes.legacy}:{})},cpu:{'catalog.json':f.bytes.catalog,'verification.json':f.bytes.cpu,...(f.bytes.core?{'core.json':f.bytes.core}:{})},hear:{'verification.json':f.bytes.hear},qualification:{'qualification.json':Buffer.from(JSON.stringify(qualification))}};
 const actual={id:run,run_attempt:attempt,repository:{full_name:'lwtlab/reader'},head_sha:f.value.workflow,head_branch:f.manifest.publicBranch,event:'workflow_dispatch',status:'in_progress',conclusion:null,workflow_id:10};
 const pull={number:f.example.pr,state:'open',head:{sha:f.example.head,ref:f.example.branch,repo:{full_name:'lwtlab/lwt-core'}},base:{ref:f.example.baseBranch,repo:{full_name:'lwtlab/lwt-core'}},author_association:'OWNER',mergeable:true,merge_commit_sha:f.value.tested};
 const api=async(endpoint,method='GET',body)=>{
  if(method==='POST'){writes.push({endpoint,body});return body;}
  if(endpoint.endsWith('/statuses?per_page=100'))return [status];
  if(endpoint.includes('/pulls/'))return pull;
  if(endpoint.includes('/git/ref/'))return {object:{sha:f.example.base}};
  if(endpoint.includes('/git/commits/'))return {sha:f.value.tested,parents:[{sha:f.example.base},{sha:f.example.head}]};
  if(endpoint.includes('/jobs?'))return {total_count:jobs.length,jobs};
  if(endpoint.includes('/workflows/'))return {id:10,path:'.github/workflows/reader-private-verify.yml'};
  if(endpoint.endsWith(`/runs/${run}`))return actual;
  assert.fail('Unexpected fake API request');
 };
 const readArtifact=async(_api,_value,{prefix,names})=>{assert.deepEqual(Object.keys(files[prefix]).sort(),[...names].sort());return files[prefix];};
 const options={run,attempt,id,manifest:f.manifest,token:'GENERATED_TOKEN',readArtifact};
 return {...f,api,options,files,jobs,writes,actual,pull,setStatus:s=>{status=s;}};
}
test('privileged reporter independently reconstructs both selected/full coverage and writes only new context',async()=>{
 for(const id of ids){const f=reporterFixture(id);assert.equal((await collectSelected(f.api,f.value,f.options)).status,'PASS');assert.equal(await reportSelected(f.api,f.value,f.options),'success');assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.context,'reader-hear-public/selected');assert.equal(f.writes[0].body.state,'success');}
});
test('reporter refuses stale run, changed source, false job outcomes and altered final receipt',async()=>{
 for(const mutate of [f=>f.actual.head_sha='e'.repeat(40),f=>f.actual.run_attempt++,f=>{f.actual.status='completed';f.actual.conclusion='cancelled';},f=>{f.actual.status='completed';f.actual.conclusion='failure';},f=>{f.actual.status='completed';f.actual.conclusion='timed_out';},f=>f.pull.head.sha='e'.repeat(40),f=>f.jobs[1].conclusion='skipped',f=>f.jobs.pop(),f=>f.files.qualification['qualification.json']=Buffer.from('{}'),f=>f.files.reader['selection.json']=Buffer.from('{}')]){const f=reporterFixture();mutate(f);assert.equal(await reportSelected(f.api,f.value,f.options),'error');assert.equal(f.writes.length,1);assert.notEqual(f.writes[0].body.state,'success');}
 for(const conclusion of ['cancelled','failure','timed_out']){const f=reporterFixture(),read=f.options.readArtifact;f.options.readArtifact=async(...args)=>{f.actual.status='completed';f.actual.conclusion=conclusion;return read(...args);};assert.equal(await reportSelected(f.api,f.value,f.options),'error');assert.equal(f.writes.length,1);assert.notEqual(f.writes[0].body.state,'success');}
 const f=reporterFixture();f.setStatus({state:'pending',description:'new run',target_url:'new run'});assert.equal(await reportSelected(f.api,f.value,f.options),'SUPERSEDED');assert.equal(f.writes.length,0);
 const duringFinalRun=reporterFixture();let runReads=0;const changedPendingApi=async(...args)=>{if(args[0].endsWith(`/runs/${run}`)&&++runReads===2)duringFinalRun.setStatus({state:'pending',description:'new run',target_url:'new run'});return duringFinalRun.api(...args);};assert.equal(await reportSelected(changedPendingApi,duringFinalRun.value,duringFinalRun.options),'SUPERSEDED');assert.equal(duringFinalRun.writes.length,0);
 const g=reporterFixture(),read=g.options.readArtifact;g.options.readArtifact=async(...args)=>{g.setStatus({state:'pending',description:'new run',target_url:'new run'});return read(...args);};assert.equal(await reportSelected(g.api,g.value,g.options),'SUPERSEDED');assert.equal(g.writes.length,0);
});
function zip(t,entries){const folder=mkdtempSync(join(tmpdir(),'selected-test-zip-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));const file=join(folder,'test.zip');execFileSync('python3',['-c',`import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for name,data,mode in json.loads(sys.argv[2]):\n  info=zipfile.ZipInfo(name);info.external_attr=mode<<16;z.writestr(info,data)`,file,JSON.stringify(entries)]);return readFileSync(file);}
test('actual ZIP parser rejects links, traversal, duplicates, extra members and oversized JSON',t=>{
 assert.equal(artifactMembers(zip(t,[['plan.json','{}',0o100600]]),['plan.json'])['plan.json'].toString(),'{}');
 for(const entries of [[['../plan.json','{}',0o100600]],[['plan.json','{}',0o120777]],[['plan.json','{}',0o100600],['plan.json','{}',0o100600]],[['plan.json','{}',0o100600],['other.json','{}',0o100600]],[['plan.json','x'.repeat(65537),0o100600]]])assert.throws(()=>artifactMembers(zip(t,entries),['plan.json']));
});
test('artifact download binds digest/run/workflow and never forwards the secret on signed redirects',async t=>{
 const f=fixture(),bytes=zip(t,[['plan.json','{}',0o100600]]),artifact={id:5,name:`reader-selected-plan-result-${run}-${attempt}`,expired:false,workflow_run:{id:run,head_sha:f.value.workflow},digest:`sha256:${digest(bytes)}`,size_in_bytes:bytes.length};let calls=0;
 const transport=async(_url,options)=>{calls++;if(calls%2){assert.equal(options.headers.Authorization,'Bearer GENERATED_TOKEN');assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://storage.invalid/signed'}});}assert.equal(options.headers,undefined);return new Response(bytes);};
 const options={run,attempt,token:'GENERATED_TOKEN',prefix:'plan',names:['plan.json'],transport};const api=async()=>({total_count:1,artifacts:[artifact]});assert.equal((await readSelectedArtifact(api,f.value,options))['plan.json'].toString(),'{}');
 for(const mutate of [a=>a.workflow_run.head_sha='0'.repeat(40),a=>a.expired=true,a=>a.size_in_bytes++,a=>a.digest='sha256:'+'0'.repeat(64)]){const changed=structuredClone(artifact);mutate(changed);await assert.rejects(readSelectedArtifact(async()=>({total_count:1,artifacts:[changed]}),f.value,options));}
});
test('actual aggregate and probe CLIs fail closed without source-bound component inputs',t=>{
 const folder=mkdtempSync(join(tmpdir(),'selected-cli-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));const e=MANIFEST.examples[1],value={head:e.head,base:e.base,tested:'c'.repeat(40),workflow:'d'.repeat(40),pr:e.pr};const cli=new URL('./selected-source.mjs',import.meta.url).pathname;
 const env={...process.env,GITHUB_REPOSITORY:'lwtlab/reader',GITHUB_REF:`refs/heads/${MANIFEST.publicBranch}`,GITHUB_SHA:value.workflow,GITHUB_RUN_ID:String(run),GITHUB_RUN_ATTEMPT:String(attempt),SELECTION_CASE:e.id,VERIFICATION_BINDING:JSON.stringify(value),SELECTION_OUTCOMES:JSON.stringify({plan:'success',reader:'success',cpu:'success',hear:'skipped'})};
 const child=spawnSync(process.execPath,[cli,'aggregate'],{cwd:folder,env,encoding:'utf8'});assert.equal(child.status,1);assert.doesNotMatch(child.stdout+child.stderr,/Error:|selected-cli-/);assert.equal(JSON.parse(readFileSync(join(folder,'selected-output/qualification.json'))).status,'FAIL');
 rmSync(join(folder,'selected-output'),{recursive:true});const probe=spawnSync(process.execPath,[cli,'probe'],{cwd:folder,env:{...env,SELECTION_PROBE:'true'},encoding:'utf8'});assert.equal(probe.status,1);assert.throws(()=>readFileSync(join(folder,'selected-output/qualification.json')));
});
test('actual aggregate and focused probe CLIs consume valid generated receipts with separate contracts',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'selected-cli-positive-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const cli=new URL('./selected-source.mjs',import.meta.url).pathname;
 for(const mode of ['aggregate','probe']){
  const f=fixture(mode==='aggregate'?'hear-only':'reader-only',MANIFEST),folder=join(root,mode);mkdirSync(folder);
  const write=(lane,name,data)=>{const dir=join(folder,'selected-inputs',lane);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name),data);};
  write('plan','plan.json',f.bytes.plan);write('cpu','verification.json',f.bytes.cpu);write('cpu','catalog.json',f.bytes.catalog);
  if(f.bytes.core)write('cpu','core.json',f.bytes.core);
  if(mode==='aggregate'){write('reader','selection.json',f.bytes.reader);write('hear','verification.json',f.bytes.hear);}
  const child=spawnSync(process.execPath,[cli,mode],{cwd:folder,env:{...process.env,GITHUB_REPOSITORY:'lwtlab/reader',GITHUB_REF:`refs/heads/${MANIFEST.publicBranch}`,GITHUB_SHA:f.value.workflow,GITHUB_RUN_ID:String(run),GITHUB_RUN_ATTEMPT:String(attempt),SELECTION_CASE:f.id,SELECTION_PROBE:String(mode==='probe'),VERIFICATION_BINDING:JSON.stringify(f.value),SELECTION_OUTCOMES:JSON.stringify(f.outcomes)},encoding:'utf8'});
  assert.equal(child.status,0,mode+": "+child.stdout+child.stderr);
  const file=join(folder,'selected-output',mode==='aggregate'?'qualification.json':'probe.json'),receipt=JSON.parse(readFileSync(file));
  assert.equal(receipt.status,mode==='aggregate'?'PASS':'NOT_QUALIFIED');
  if(mode==='probe'){assert.equal(receipt.contextWritten,false);assert.equal(receipt.acceptance.sourceExecution,'NOT_RUN');assert.throws(()=>readFileSync(join(folder,'selected-output/qualification.json')));}
 }
});
test('workflow isolates selected scope, privileged reporting and diagnostic probes without changing full defaults',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8'),selected=yaml.slice(yaml.indexOf('  resolve-selected:')),reader=selected.split('  selected-reader:')[1].split('  selected-cpu:')[0],cpu=selected.split('  selected-cpu:')[1].split('  selected-hear:')[0],report=selected.split('  report-selected:')[1].split('  resolve-gui-diagnostic:')[0];
 assert.match(yaml,/default: full/);assert.match(yaml,/inputs.scope != 'change-example' && inputs.scope != 'selected-source'/);assert.match(reader,/READER_SELECTED_PROFILE: \$\{\{ needs.selected-plan.outputs.reader_profile \}\}/);assert.match(reader,/always\(\) && needs.selected-plan.outputs.reader_profile == 'full'/);assert(!reader.includes('READER_VERIFICATION_TOKEN'));assert(!cpu.includes('READER_VERIFICATION_TOKEN'));assert(!report.includes('PRIVATE_SOURCE_SSH_KEY'));assert(!report.includes('repository: lwtlab/lwt-core'));assert.match(report,/!inputs.selection_probe/);assert.match(selected,/reader-selected-component-probe-/);assert.match(selected,/node hear-ci\/ci\/private-step.mjs selected-plan core node scripts\/verify-selected.mjs plan/);assert.match(selected,/core_required == 'true'/);assert.match(selected,/hear_required == 'true'/);assert(!/path:.*(?:\.artifacts\/verify|source\/)/.test(selected));
});

test('actual quick browser preparation wrapper executes required Chromium/Chrome installer in the source checkout',t=>{
 const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8'),reader=yaml.split('  selected-reader:')[1].split('  selected-cpu:')[0];
 const block=reader.split('      - name: Install quick preflight Chromium and Chrome')[1]?.split('      - name:')[0];assert(block);assert.match(block,/reader_profile == 'quick'/);
 const command=block.match(/        run: (.+)/)[1],args=command.split(' ');assert.deepEqual(args.slice(0,4),['node','ci/private-step.mjs','browsers','source']);
 const root=realpathSync(mkdtempSync(join(tmpdir(),'selected-quick-browser-')));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'source'));mkdirSync(join(root,'runtime'));mkdirSync(join(root,'bin'));
 const record=join(root,'installer.json'),fake=join(root,'bin','pnpm');writeFileSync(fake,`#!${process.execPath}\nimport{writeFileSync}from'node:fs';writeFileSync(process.env.GENERATED_INSTALLER_RECORD,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));`);chmodSync(fake,0o700);
 const wrapper=new URL('./private-step.mjs',import.meta.url).pathname,child=spawnSync(process.execPath,[wrapper,...args.slice(2)],{cwd:root,env:{...process.env,RUNNER_TEMP:join(root,'runtime'),GENERATED_INSTALLER_RECORD:record,PATH:join(root,'bin')+':'+process.env.PATH},encoding:'utf8'});assert.equal(child.status,0,child.stdout+child.stderr);
 assert.deepEqual(JSON.parse(readFileSync(record)),{args:['--dir','apps/reader','exec','playwright','install','--with-deps','chromium','chrome'],cwd:join(root,'source')});
});
