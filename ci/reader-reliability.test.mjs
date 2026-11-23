import assert from 'node:assert/strict';
import test from 'node:test';
import {binding} from './reader-verification.mjs';
import {profiles,contract,fingerprint,result,validateResult} from './reader-reliability-verification.mjs';
const value=binding({head:'a'.repeat(40),base:'b'.repeat(40),tested:'c'.repeat(40),pr:1,workflow:'d'.repeat(40)});
const options={profile:'sync-journey',run:10,attempt:1};
const summary=()=>({binding:value,...options,contractSha256:contract(options.profile),sourceBefore:{head:value.tested,dirty:false},sourceAfter:{head:value.tested,dirty:false},tasks:profiles[options.profile].tasks.map(t=>({id:t.id,status:'PASS',exitCode:0,durationMs:10}))});
const receipt=()=>result(summary(),value,{...options,execution:'success',bytes:Buffer.from('synthetic'),diagnostics:'e'.repeat(64)});
test('each profile has an independent contract and status identity',()=>{
  assert.equal(profiles['sync-journey'].context,'reader-public/sync-journey');
  assert.notEqual(contract('sync-journey'),contract('large-library'));
  assert.notEqual(fingerprint(value,'sync-journey'),fingerprint(value,'playback-soak'));
  assert.throws(()=>contract('shell-command'));
});
test('only complete fresh tasks on the exact clean source and run can pass',()=>{
  assert.equal(validateResult(receipt(),value,options).status,'PASS');
  for(const mutate of [s=>s.sourceAfter.dirty=true,s=>s.sourceBefore.head=value.head,s=>s.tasks.pop(),s=>s.tasks[0].status='NOT_RUN',s=>s.tasks[0].exitCode=1,s=>s.run++,s=>s.attempt++,s=>s.contractSha256='f'.repeat(64),s=>s.profile='large-library',s=>s.tasks.push(s.tasks[0])]){
    const s=summary();mutate(s);assert.equal(result(s,value,{...options,execution:'success',bytes:Buffer.from('s'),diagnostics:'e'.repeat(64)}).status,'FAIL');
  }
  for(const execution of ['failure','cancelled','skipped',undefined])assert.equal(result(summary(),value,{...options,execution,bytes:Buffer.from('s'),diagnostics:'e'.repeat(64)}).status,'FAIL');
  assert.equal(result(summary(),value,{...options,execution:'success'}).status,'FAIL');
});
test('public results are closed and cannot carry private output or another profile result',()=>{
  const s=summary();s.error='PRIVATE';s.tasks[0].stdout='PRIVATE';
  const r=result(s,value,{...options,execution:'success',bytes:Buffer.from('s'),diagnostics:'e'.repeat(64)});
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
  for(const mutate of [r=>r.error='PRIVATE',r=>r.tasks[0].path='PRIVATE',r=>r.run++,r=>r.attempt++,r=>r.profile='large-library',r=>r.contractSha256='f'.repeat(64),r=>r.tasks[0].id='unknown']){
    const r=receipt();mutate(r);assert.throws(()=>validateResult(r,value,options));
  }
});

const {reportReliability}=await import('./reader-reliability-control.mjs');
function reportingFixture({job='success',receiptValue=receipt(),stale=false,wrongRun=false,newer=false}={}){
  const posts=[],url='https://github.com/lwtlab/reader/actions/runs/10/attempts/1';let reads=0;
  const status={target_url:url,description:`reliability pending ${fingerprint(value,options.profile)}`,context:profiles[options.profile].context};
  const api=async(route,method,body)=>{
    if(method==='POST'){posts.push(body);return {};}
    if(route.endsWith('/actions/runs/10'))return {id:wrongRun?11:10,run_attempt:1,repository:{full_name:'lwtlab/reader'},head_sha:value.workflow,workflow_id:22,event:'workflow_dispatch'};
    if(route.endsWith('/actions/workflows/reader-private-verify.yml'))return {id:22};
    if(route.includes('/attempts/1/jobs?'))return {jobs:[{name:'Private Reader reliability verification',conclusion:job}]};
    if(route.includes('/statuses?')){reads++;return [newer&&reads>1?{...status,target_url:'new run'}:status];}
    if(route.endsWith('/pulls/1'))return {state:'open',head:{sha:stale?'f'.repeat(40):value.head}};
    if(route.endsWith('/git/ref/heads/main'))return {object:{sha:value.base}};
    assert.fail(`Unexpected controller route ${route}`);
  };
  return {posts,run:()=>reportReliability(api,value,{...options,job,receipt:async()=>{if(receiptValue instanceof Error)throw receiptValue;return receiptValue;}})};
}
test('reporter validates actual job, provenance, profile, current source and receipt before success',async()=>{
  const good=reportingFixture();assert.equal(await good.run(),'success');assert.equal(good.posts[0].context,'reader-public/sync-journey');
  for(const change of [{job:'cancelled'},{stale:true},{wrongRun:true},{receiptValue:new Error('missing')},{receiptValue:{...receipt(),attempt:2}},{receiptValue:{...receipt(),profile:'large-library'}}]){
    const fixture=reportingFixture(change);assert.notEqual(await fixture.run(),'success');assert.notEqual(fixture.posts[0]?.state,'success');
  }
  const newer=reportingFixture({newer:true});assert.equal(await newer.run(),'SUPERSEDED');assert.equal(newer.posts.length,0);
});

const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,existsSync,symlinkSync}=await import('node:fs');
const {tmpdir}=await import('node:os');
const path=await import('node:path');
const {spawnSync,execFileSync}=await import('node:child_process');
const {generateKeyPairSync}=await import('node:crypto');
const {decryptLog}=await import('./log-crypto.mjs');

test('real runner captures private output, checks source stability and seals diagnostics before issuing a result',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'reader-reliability-cli-'));
  try{
    const source=path.join(directory,'source'),app=path.join(source,'apps/reader'),ci=path.join(directory,'ci'),temp=path.join(directory,'temp');
    for(const folder of [app,ci,temp])mkdirSync(folder,{recursive:true});
    for(const name of ['reader-reliability-run.mjs','reader-reliability-verification.mjs','reader-verification.mjs','log-crypto.mjs'])copyFileSync(new URL(name,import.meta.url),path.join(ci,name));
    const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});writeFileSync(path.join(ci,'build-logs-public.pem'),publicKey.export({type:'spki',format:'pem'}));
    writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'synthetic-reliability',scripts:{'test:sync-journey':'node workload.mjs'}}));
    writeFileSync(path.join(app,'workload.mjs'),"console.log('PRIVATE_STDOUT'); console.error('PRIVATE_STDERR'); if(process.env.GH_TOKEN)throw Error('credential leaked'); if(process.env.READER_RELIABILITY_SOAK_SECONDS!=='7200')throw Error('shortened soak');");
    writeFileSync(path.join(source,'.gitignore'),'node_modules/\n.artifacts/\n');
    execFileSync('pnpm',['install','--ignore-scripts'],{cwd:app,stdio:'pipe',env:{...process.env,CI:'1'}});
    const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git(['init','-q']);git(['add','.']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','-c','core.hooksPath=/dev/null','commit','--no-gpg-sign','-qm','synthetic']);
    const head=git(['rev-parse','HEAD']),v=binding({head,base:head,tested:head,pr:0,workflow:value.workflow});
    const env={...process.env,VERIFICATION_BINDING:JSON.stringify(v),RELIABILITY_PROFILE:'sync-journey',GITHUB_RUN_ID:'10',GITHUB_RUN_ATTEMPT:'1',RUNNER_TEMP:temp,VERIFICATION_OUTCOME:'success',GH_TOKEN:'SYNTHETIC_CREDENTIAL',READER_RELIABILITY_SOAK_SECONDS:'1'};
    const invoke=operation=>spawnSync(process.execPath,[path.join(ci,'reader-reliability-run.mjs'),operation],{cwd:directory,env,encoding:'utf8'});
    for(const step of ['identity','verify','seal','receipt','require']){const r=invoke(step);assert.equal(r.status,0,`${step}: ${r.stderr}; ${r.stdout}`);assert.doesNotMatch(r.stdout+r.stderr,/PRIVATE_|SYNTHETIC_CREDENTIAL/);}
    const output=path.join(directory,'reliability-output');const receipt=JSON.parse(readFileSync(path.join(output,'verification.json')));validateResult(receipt,v,options);assert.equal(receipt.status,'PASS');
    const clear=decryptLog(JSON.parse(readFileSync(path.join(output,'diagnostics.enc.json'))),privateKey);writeFileSync(path.join(temp,'archive.tar.gz'),clear);
    assert.match(execFileSync('tar',['-xzOf',path.join(temp,'archive.tar.gz')],{encoding:'utf8'}),/PRIVATE_STDOUT/);
    writeFileSync(path.join(source,'new-private-source'),'changed after verification');
    assert.equal(invoke('receipt').status,0);assert.equal(JSON.parse(readFileSync(path.join(output,'verification.json'))).status,'FAIL');assert.notEqual(invoke('require').status,0);
    // An approved diagnostics directory must never escape into the source tree.
    const artifacts=path.join(source,'.artifacts/public-reliability');mkdirSync(artifacts,{recursive:true});symlinkSync(path.join(app,'workload.mjs'),path.join(artifacts,'escape'));
    assert.notEqual(invoke('seal').status,0);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('reliability workflow keeps test credentials separate and only uploads closed or encrypted artifacts',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/reader-private-verify.yml',import.meta.url),'utf8');
  const block=yaml.split('\n  reliability:')[1].split('\n  report-reliability:')[0];
  assert.doesNotMatch(block,/READER_VERIFICATION_TOKEN|SIGNING|PUBLISH_TOKEN|pull_request_target/);
  assert.match(block,/fetch-depth: 0/);assert.match(block,/persist-credentials: false/);
  for(const upload of block.split('uses: actions/upload-artifact@').slice(1))assert.match(upload,/path: reliability-output\/(verification.json|diagnostics.enc.json)/);
});

test('status lookup follows complete bounded pages rather than losing a new context behind other checks',async()=>{
  const {latest}=await import('./reader-reliability-control.mjs');let calls=0;
  const match={context:'reader-public/sync-journey',state:'pending'};
  const api=async route=>{calls++;return route.endsWith('page=1')?Array.from({length:100},()=>({context:'other'})):[match];};
  assert.deepEqual(await latest(api,value,'sync-journey'),match);assert.equal(calls,2);
  await assert.rejects(latest(async()=>Array.from({length:100},()=>({context:'other'})),value,'sync-journey'));
});

test('automatic discovery is opt-in, deduplicates exact sources and retries no failures within a day',async()=>{
  const {pollReliability}=await import('./reader-reliability-control.mjs');
  assert.deepEqual(await pollReliability(()=>assert.fail('disabled poll reads nothing'),value.workflow,{enabled:false}),{disabled:true,dispatched:0});
  const posts=[];let known=[];
  const api=async(route,method,body)=>{
    if(method==='POST'){posts.push(body);return {};}
    if(route.includes('git/ref/heads/ci/reader-reliability-20261117'))return {object:{sha:value.workflow}};
    if(route.includes('pulls?'))return [];
    if(route.endsWith('/git/ref/heads/main'))return {object:{sha:value.head}};
    if(route.includes('/contents/'))return {encoding:'base64',content:Buffer.from(JSON.stringify({scripts:{'test:sync-journey':'real command','test:reader-reliability':'real command'}})).toString('base64')};
    if(route.includes('/statuses?'))return known;
    assert.fail(`Unexpected poll route ${route}`);
  };
  assert.equal((await pollReliability(api,value.workflow,{enabled:true,now:new Date('2026-11-17T01:00:00Z')})).dispatched,2);
  assert.deepEqual(posts.map(p=>p.inputs.scope),['sync-journey','large-library']);
  const mainValue={...value,base:value.head,tested:value.head,pr:0};
  known=['sync-journey','large-library'].map(p=>({context:profiles[p].context,state:'failure',description:`reliability FAIL ${fingerprint(mainValue,p)}`,created_at:'2026-11-17T00:00:00Z'}));
  posts.length=0;assert.equal((await pollReliability(api,value.workflow,{enabled:true,now:new Date('2026-11-17T02:00:00Z')})).dispatched,0);
  assert.equal((await pollReliability(api,value.workflow,{enabled:true,now:new Date('2026-11-18T01:00:00Z')})).dispatched,1);assert.equal(posts[0].inputs.scope,'large-library');
});

test('discovery exposes infrastructure failures and never overwrites a result that replaced pending',async()=>{
  const {pollReliability}=await import('./reader-reliability-control.mjs');
  const v={...value,pr:0,base:value.head,tested:value.head};
  for(const replacement of ['success','new-pending','unchanged']){
    const posts=[];let reads=0;
    const pending={context:'reader-public/sync-journey',state:'pending',target_url:'https://github.com/lwtlab/reader/actions/runs/10/attempts/1',description:`reliability pending ${fingerprint(v,'sync-journey')}`};
    const api=async(route,method,body)=>{
      if(method==='POST'){posts.push(body);return {};}
      if(route.includes('heads/ci/reader-reliability-20261117'))return {object:{sha:value.workflow}};
      if(route.includes('pulls?'))return [];
      if(route.endsWith('heads/main'))return {object:{sha:value.head}};
      if(route.includes('/contents/'))return {encoding:'base64',content:Buffer.from(JSON.stringify({scripts:{'test:sync-journey':'real'}})).toString('base64')};
      if(route.includes('/statuses?')){reads++;return [reads===1||replacement==='unchanged'?pending:replacement==='success'?{...pending,state:'success',description:'reliability PASS'}:{...pending,target_url:'new run'}];}
      if(route.endsWith('actions/runs/10'))return {status:'completed'};
      assert.fail('Unexpected discovery route');
    };
    await pollReliability(api,value.workflow,{enabled:true});assert.equal(posts.length,replacement==='unchanged'?1:0);
  }
  const api=async route=>{
    if(route.includes('heads/ci/reader-reliability-20261117'))return {object:{sha:value.workflow}};
    if(route.includes('pulls?'))return [];
    if(route.endsWith('heads/main'))return {object:{sha:value.head}};
    throw Object.assign(new Error('synthetic infrastructure error'),{code:'HTTP_403'});
  };
  await assert.rejects(pollReliability(api,value.workflow,{enabled:true}));
});

test('ineligible or changed candidates cannot starve later trusted PRs',async()=>{
  const {pollReliability}=await import('./reader-reliability-control.mjs');
  const good={number:2,state:'open',author_association:'MEMBER',head:{sha:value.head,repo:{full_name:'lwtlab/lwt-core'}},base:{ref:'main',repo:{full_name:'lwtlab/lwt-core'}},mergeable:true,merge_commit_sha:value.tested};
  for(const change of [{mergeable:false},{state:'closed'},{head:{...good.head,sha:'f'.repeat(40)}},{base:{...good.base,ref:'other'}},{author_association:'NONE'}]){
    const posts=[],bad={...good,number:1,...change};
    const api=async(route,method,body)=>{
      if(method==='POST'){posts.push(body);return {};}
      if(route.includes('heads/ci/reader-reliability-20261117'))return {object:{sha:value.workflow}};
      if(route.includes('pulls?'))return [{...good,number:1},good];
      if(route.endsWith('/pulls/1'))return bad;
      if(route.endsWith('/pulls/2'))return good;
      if(route.endsWith('heads/main'))return {object:{sha:value.base}};
      if(route.includes('/git/commits/'))return {sha:value.tested,parents:[{sha:value.base},{sha:value.head}]};
      if(route.includes('/contents/'))return {encoding:'base64',content:Buffer.from(JSON.stringify({scripts:route.endsWith(`ref=${value.tested}`)?{'test:sync-journey':'real'}:{}})).toString('base64')};
      if(route.includes('/statuses?'))return [];
      assert.fail(`Unexpected discovery route ${route}`);
    };
    assert.equal((await pollReliability(api,value.workflow,{enabled:true})).dispatched,1);
    assert.equal(posts.length,1);assert.equal(posts[0].inputs.pr_number,'2');
  }
});

test('discovery defers a moved main but propagates malformed PR metadata and permission failures',async()=>{
  const {pollReliability}=await import('./reader-reliability-control.mjs');
  for(const failure of [null,'invalid','forbidden']){
    let mainReads=0;const posts=[];
    const api=async(route,method,body)=>{
      if(method==='POST'){posts.push(body);return {};}
      if(route.includes('heads/ci/reader-reliability-20261117'))return {object:{sha:value.workflow}};
      if(route.includes('pulls?'))return [{number:1,author_association:'MEMBER',head:{sha:value.head,repo:{full_name:'lwtlab/lwt-core'}}}];
      if(route.endsWith('heads/main')){mainReads++;return {object:{sha:mainReads===1?value.base:'f'.repeat(40)}};}
      if(route.endsWith('/pulls/1')){
        if(failure==='forbidden')throw Object.assign(new Error('Synthetic permission failure'),{code:'HTTP_403'});
        return failure==='invalid'?{state:'open'}:{number:1,state:'open',author_association:'MEMBER',head:{sha:value.head,repo:{full_name:'lwtlab/lwt-core'}},base:{ref:'main',repo:{full_name:'lwtlab/lwt-core'}},mergeable:true,merge_commit_sha:value.tested};
      }
      if(route.includes('/git/commits/'))return {sha:value.tested,parents:[{sha:'f'.repeat(40)},{sha:value.head}]};
      if(route.includes('/contents/'))return {encoding:'base64',content:Buffer.from(JSON.stringify({scripts:{'test:sync-journey':'real'}})).toString('base64')};
      if(route.includes('/statuses?'))return [];
      assert.fail(`Unexpected discovery route ${route}`);
    };
    if(failure)await assert.rejects(pollReliability(api,value.workflow,{enabled:true}));
    else {assert.equal((await pollReliability(api,value.workflow,{enabled:true})).dispatched,1);assert.equal(posts[0].inputs.pr_number,'1');}
  }
});
