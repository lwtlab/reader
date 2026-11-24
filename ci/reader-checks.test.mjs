import assert from 'node:assert/strict';
import test from 'node:test';
import {binding} from './reader-verification.mjs';
import {profiles,contract,fingerprint,result,validateResult} from './reader-reliability-verification.mjs';
import {pollChecks,CHECKS_REF,checkProfile} from './reader-checks-control.mjs';
import {executeTasks} from './reader-reliability-run.mjs';
import {reportReliability} from './reader-reliability-control.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const value=binding({head:'a'.repeat(40),base:'b'.repeat(40),tested:'c'.repeat(40),pr:1,workflow:'d'.repeat(40)});
const scopes=['public-integration','release-privacy'];
test('additional checks preserve the three qualified reliability contracts',()=>{
  assert.equal(contract('sync-journey'),'23da98aaa6b7a99f26261d20618382da967e735582189a01fbb2ffc86418ec97');
  assert.equal(contract('large-library'),'4dd7914e98454705adb8455465d2ce2136bf994518494c82a046f43588c022fe');
  assert.equal(contract('playback-soak'),'6819ed1f95d7cd6f2efd9526ad38e2600866fe466aa81fc11c715d83188405b1');
  for(const scope of scopes){
    assert.equal(profiles[scope]?.context,`reader-public/${scope}`);
    assert(profiles[scope].tasks.every(task=>task.cwd==='.'),'Root commands must not run in the Reader application');
  }
  assert.deepEqual(profiles['public-integration'].tasks.map(t=>t.command),[
    ['node','scripts/sync-release-privacy.mjs','--check'],['bash','scripts/reader-public.sh','check'],
  ]);
  assert.deepEqual(profiles['release-privacy'].tasks.map(t=>t.command),[
    ['node','--test','scripts/release/privacy.test.mjs'],['node','scripts/release-privacy.mjs','apps/reader/extension'],
  ]);
});
test('additional checks require their own complete contract, source, run and sealed diagnostics',()=>{
  for(const profile of scopes){
    const options={profile,run:10,attempt:1};
    const summary=()=>({binding:value,...options,contractSha256:contract(profile),sourceBefore:{head:value.tested,dirty:false},sourceAfter:{head:value.tested,dirty:false},tasks:profiles[profile].tasks.map(t=>({id:t.id,status:'PASS',exitCode:0,durationMs:10}))});
    const receipt=s=>result(s,value,{...options,execution:'success',bytes:Buffer.from('synthetic'),diagnostics:'e'.repeat(64)});
    assert.equal(validateResult(receipt(summary()),value,options).status,'PASS');
    for(const mutate of [s=>s.tasks.pop(),s=>s.tasks[1].status='NOT_RUN',s=>s.tasks[0].exitCode=1,s=>s.sourceAfter.dirty=true,s=>s.attempt++,s=>s.contractSha256='f'.repeat(64)]){
      const s=summary();mutate(s);assert.equal(receipt(s).status,'FAIL');
    }
    const r=receipt(summary());assert.throws(()=>validateResult({...r,profile:scopes.find(s=>s!==profile)},value,options));
    assert.throws(()=>validateResult({...r,privateOutput:'SYNTHETIC'},value,options));
  }
  assert.notEqual(fingerprint(value,scopes[0]),fingerprint(value,scopes[1]));
});

test('root executor captures output, strips credentials and stops before unexecuted tasks',async()=>{
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'reader-independent-executor-')));
  const before={GH_TOKEN:process.env.GH_TOKEN,GITHUB_TOKEN:process.env.GITHUB_TOKEN};
  try{
    const source=path.join(root,'source');mkdirSync(path.join(source,'scripts'),{recursive:true});
    const first=path.join(source,'scripts/sync-release-privacy.mjs');
    writeFileSync(first,`if(process.cwd()!==${JSON.stringify(source)})throw Error('wrong root');if(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)throw Error('credential');console.log('SYNTHETIC_PRIVATE_OUTPUT');`);
    writeFileSync(path.join(source,'scripts/reader-public.sh'),'#!/usr/bin/env bash\nset -euo pipefail\nnode scripts/sync-release-privacy.mjs\n');
    process.env.GH_TOKEN='SYNTHETIC_CREDENTIAL';process.env.GITHUB_TOKEN='SYNTHETIC_CREDENTIAL';
    const summary=()=>({profile:'public-integration',tasks:profiles['public-integration'].tasks.map(t=>({id:t.id,status:'NOT_RUN'}))});
    const state=summary(),chunks=[],saved=[];
    assert.equal(await executeTasks(state,source,chunk=>chunks.push(chunk),s=>saved.push(structuredClone(s))),true);
    assert.deepEqual(state.tasks.map(t=>t.status),['PASS','PASS']);assert.equal(saved.length,2);
    assert.match(Buffer.concat(chunks).toString(),/SYNTHETIC_PRIVATE_OUTPUT/);
    writeFileSync(first,"throw Error('SYNTHETIC_COMMAND_FAILURE');");
    const failed=summary();assert.equal(await executeTasks(failed,source,()=>{},()=>{}),false);
    assert.deepEqual(failed.tasks.map(t=>t.status),['FAIL','NOT_RUN']);
  }finally{
    for(const [key,val]of Object.entries(before))if(val===undefined)delete process.env[key];else process.env[key]=val;
    rmSync(root,{recursive:true,force:true});
  }
});

function discovery({known=[],invalid=false,error=false}={}){
  const posts=[];
  const main=binding({head:value.base,base:value.base,tested:value.base,workflow:value.workflow});
  const api=async(route,method,body)=>{
    if(method==='POST'){posts.push({route,body});return {};}
    if(route.endsWith(`heads/${CHECKS_REF}`))return {object:{sha:value.workflow}};
    if(route.includes('/pulls?'))return [{number:1,author_association:'OWNER',head:{sha:value.head,repo:{full_name:'lwtlab/lwt-core'}}}];
    if(route.endsWith('heads/main'))return {object:{sha:value.base}};
    if(route.endsWith('/pulls/1')){
      if(error)throw Object.assign(new Error('Synthetic infrastructure failure'),{code:'HTTP_403'});
      return {number:1,state:invalid?'closed':'open',author_association:'OWNER',head:{sha:value.head,repo:{full_name:'lwtlab/lwt-core'}},base:{ref:'main',repo:{full_name:'lwtlab/lwt-core'}},mergeable:true,merge_commit_sha:value.tested};
    }
    if(route.endsWith(`/git/commits/${value.tested}`))return {sha:value.tested,parents:[{sha:value.base},{sha:value.head}]};
    if(route.includes('/statuses?'))return known.filter(row=>row.head===(route.includes(value.head)?value.head:main.head));
    assert.fail(`Unexpected independent discovery route ${route}`);
  };
  return {posts,api,main};
}
test('public discovery needs no private job, selects both checks and deduplicates success and failure',async()=>{
  assert.deepEqual(await pollChecks(()=>assert.fail('disabled poll must read nothing'),value.workflow),{disabled:true,dispatched:0});
  const fixture=discovery();assert.equal((await pollChecks(fixture.api,value.workflow,{enabled:true})).dispatched,4);
  assert.deepEqual(fixture.posts.map(p=>p.body.inputs.scope),[...scopes,...scopes]);
  assert(fixture.posts.every(p=>p.body.ref===CHECKS_REF));
  for(const state of ['success','failure','error']){
    const known=[value,fixture.main].flatMap(v=>scopes.map(profile=>({head:v.head,context:profiles[profile].context,state,description:`reliability ${state} ${fingerprint(v,profile)}`})));
    const done=discovery({known});assert.equal((await pollChecks(done.api,value.workflow,{enabled:true})).dispatched,0);
  }
  const invalid=discovery({invalid:true});assert.equal((await pollChecks(invalid.api,value.workflow,{enabled:true})).dispatched,2);
  await assert.rejects(pollChecks(discovery({error:true}).api,value.workflow,{enabled:true}));
  assert.throws(()=>checkProfile('sync-journey'));assert.throws(()=>checkProfile('shell-command'));
});
test('completed pending is reconciled only if no newer result replaced it',async()=>{
  for(const replaced of [false,true]){
    const initial=discovery(),known=[value,initial.main].flatMap(v=>scopes.map(profile=>({head:v.head,context:profiles[profile].context,state:'success',description:`reliability PASS ${fingerprint(v,profile)}`})));
    const target=known.find(row=>row.head===value.head&&row.context===profiles['public-integration'].context);
    Object.assign(target,{state:'pending',description:`reliability pending ${fingerprint(value,'public-integration')}`,target_url:'https://github.com/lwtlab/reader/actions/runs/10/attempts/1'});
    const fixture=discovery({known});let reads=0;
    const api=async(route,...args)=>{
      if(route.includes(`/commits/${value.head}/statuses?`)&&++reads>1&&replaced)Object.assign(target,{state:'success',description:`reliability PASS ${fingerprint(value,'public-integration')}`});
      if(route.endsWith('/actions/runs/10'))return {status:'completed'};
      return fixture.api(route,...args);
    };
    assert.equal((await pollChecks(api,value.workflow,{enabled:true})).dispatched,0);
    assert.equal(fixture.posts.length,replaced?0:1);
    if(!replaced)assert.equal(fixture.posts[0].body.state,'error');
  }
});
test('additional check reporters bind the actual independent job and reject partial or cross-profile results',async()=>{
  for(const profile of scopes)for(const bad of [null,'missing-job','duplicate-job','partial','wrong-profile','stale']){
    const options={profile,run:10,attempt:1},posts=[];
    const summary={binding:value,...options,contractSha256:contract(profile),sourceBefore:{head:value.tested,dirty:false},sourceAfter:{head:value.tested,dirty:false},tasks:profiles[profile].tasks.map(t=>({id:t.id,status:'PASS',exitCode:0,durationMs:10}))};
    const receipt=result(summary,value,{...options,execution:'success',bytes:Buffer.from('synthetic'),diagnostics:'e'.repeat(64)});
    if(bad==='partial')receipt.tasks.pop();
    if(bad==='wrong-profile')receipt.profile=scopes.find(s=>s!==profile);
    const api=async(route,method,body)=>{
      if(method==='POST'){posts.push(body);return {};}
      if(route.endsWith('/actions/runs/10'))return {id:10,run_attempt:1,repository:{full_name:'lwtlab/reader'},head_sha:value.workflow,workflow_id:22,event:'workflow_dispatch'};
      if(route.endsWith('/actions/workflows/reader-private-verify.yml'))return {id:22};
      if(route.includes('/attempts/1/jobs?')){
        const job={name:profiles[profile].job,conclusion:'success'};
        return {jobs:[{name:'Private Reader reliability verification',conclusion:'skipped'},...(bad==='missing-job'?[]:bad==='duplicate-job'?[job,job]:[job])]};
      }
      if(route.includes('/statuses?'))return [{context:profiles[profile].context,target_url:'https://github.com/lwtlab/reader/actions/runs/10/attempts/1',description:`reliability pending ${fingerprint(value,profile)}`}];
      if(route.endsWith('/pulls/1'))return {state:'open',head:{sha:bad==='stale'?'f'.repeat(40):value.head}};
      if(route.endsWith('/git/ref/heads/main'))return {object:{sha:value.base}};
      assert.fail(`Unexpected reporter route ${route}`);
    };
    const state=await reportReliability(api,value,{...options,job:'success',receipt:async()=>receipt});
    assert.equal(state==='success',bad===null);assert.equal(posts[0].state==='success',bad===null);
  }
});
test('independent job keeps real privacy tools, encrypted output and scoped immutable checkout',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8');
  const block=yaml.split('\n  checks:')[1]?.split('\n  report-checks:')[0];
  assert(block,'Independent executor job is required');
  assert.match(block,/uses: .\/\.github\/actions\/privacy-tools/);
  assert.match(block,/fetch-depth: 0/);assert.match(block,/persist-credentials: false/);
  assert.match(block,/submodule update --init -- public\/reader/);
  assert.doesNotMatch(block,/READER_VERIFICATION_TOKEN|SIGNING|PUBLISH_TOKEN|pull_request_target/);
  for(const upload of block.split('uses: actions/upload-artifact@').slice(1))assert.match(upload,/path: reliability-output\/(verification.json|diagnostics.enc.json)/);
  assert.match(yaml,/CHECKS_AUTOMATIC: \$\{\{ vars.READER_CHECKS_AUTOMATIC \}\}/);
});
