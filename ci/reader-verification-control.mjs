import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BUILD_REPOSITORY,SOURCE_REPOSITORY,CONTEXT,WORKFLOW,binding,sha,positive,digest,fingerprint,resolvePullRequest,verifyMergeParents,reportState,dispatchNeeded} from './reader-verification.mjs';

const policy=JSON.parse(readFileSync(new URL('./reader-verification-policy.json',import.meta.url)));
export function github(token,transport=fetch) {
  assert(token,'Authentication required');
  return async (endpoint,method='GET',body)=>{
    assert(!endpoint.startsWith('/')&&!endpoint.includes('..'));
    const response=await transport(`https://api.github.com/${endpoint}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw Object.assign(new Error(`GitHub request failed (HTTP ${response.status})`),{code:`HTTP_${response.status}`});
    return response.status===204?null:response.json();
  };
}
const endpoint=path=>`repos/${SOURCE_REPOSITORY}/${path}`;
const publicEndpoint=path=>`repos/${BUILD_REPOSITORY}/${path}`;
export async function resolveInput(api,{source,pr,workflow}) {
  sha(source);sha(workflow);
  if(pr) {
    // PR base.sha can remain at an older snapshot after main advances.
    const [pull,main]=await Promise.all([api(endpoint(`pulls/${positive(pr)}`)),api(endpoint('git/ref/heads/main'))]);
    const value=resolvePullRequest(pull,source,workflow,policy,main.object.sha);
    verifyMergeParents(await api(endpoint(`git/commits/${value.tested}`)),value);
    return value;
  }
  const main=await api(endpoint('git/ref/heads/main'));
  assert.equal(main.object.sha,source,'Only current main or a trusted open PR is accepted');
  return binding({head:source,base:source,tested:source,workflow});
}
async function latestStatus(api,value) {
  const rows=await api(endpoint(`commits/${value.head}/statuses?per_page=100`));
  return rows.find(row=>row.context===CONTEXT);
}
const runUrl=(run,attempt)=>`https://github.com/${BUILD_REPOSITORY}/actions/runs/${positive(run)}/attempts/${positive(attempt)}`;
async function postStatus(api,value,state,description,url) {
  await api(endpoint(`statuses/${value.head}`),'POST',{state,context:CONTEXT,description,target_url:url});
}
export async function liveBinding(api,value) {
  if(value.pr) {
    const [pr,main]=await Promise.all([api(endpoint(`pulls/${value.pr}`)),api(endpoint('git/ref/heads/main'))]);
    return pr.state==='open'?{head:pr.head.sha,base:main.object.sha}:{head:null,base:null};
  }
  const ref=await api(endpoint('git/ref/heads/main'));
  return {head:ref.object.sha,base:ref.object.sha};
}
export async function readReceipt(api,value,run,attempt,token,transport=fetch) {
  const pages=await api(publicEndpoint(`actions/runs/${positive(run)}/artifacts?per_page=100`));
  const rows=pages.artifacts.filter(a=>a.name===`reader-full-result-${run}-${attempt}`&&!a.expired);
  assert.equal(rows.length,1,'One exact current-attempt result is required');
  const artifact=rows[0]; assert.equal(artifact.workflow_run.id,run);assert.equal(artifact.workflow_run.head_sha,value.workflow);
  assert.match(artifact.digest,/^sha256:[a-f0-9]{64}$/); assert(artifact.size_in_bytes>0&&artifact.size_in_bytes<=262144);
  const response=await transport(`https://api.github.com/${publicEndpoint(`actions/artifacts/${positive(artifact.id)}/zip`)}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'manual',signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,302);const location=new URL(response.headers.get('location'));assert.equal(location.protocol,'https:');
  // A signed artifact redirect never receives the personal credential.
  const download=await transport(location,{signal:AbortSignal.timeout(60000)});assert(download.ok);
  const parts=[];let size=0;
  for await(const chunk of download.body){size+=chunk.length;assert(size<=262144);parts.push(chunk);}
  const bytes=Buffer.concat(parts);assert.equal(`sha256:${digest(bytes)}`,artifact.digest);
  const temp=mkdtempSync(path.join(tmpdir(),'reader-verification-result-'));
  try {
    const file=path.join(temp,'result.zip');writeFileSync(file,bytes,{mode:0o600});
    assert.deepEqual(execFileSync('unzip',['-Z1',file],{encoding:'utf8',timeout:5000,maxBuffer:4096}).trim().split('\n'),['verification.json']);
    return JSON.parse(execFileSync('unzip',['-p',file,'verification.json'],{encoding:'utf8',timeout:5000,maxBuffer:65536}));
  } finally {rmSync(temp,{recursive:true,force:true});}
}
export async function report(api,value,{run,attempt,job,token}) {
  const [actual,workflow,live,latest]=await Promise.all([
    api(publicEndpoint(`actions/runs/${positive(run)}`)),api(publicEndpoint(`actions/workflows/${WORKFLOW}`)),liveBinding(api,value),latestStatus(api,value)
  ]);
  const url=runUrl(run,attempt);
  if(latest?.target_url!==url||latest?.description!==`full pending ${fingerprint(value)}`) return 'SUPERSEDED';
  let result;
  try {result=await readReceipt(api,value,run,attempt,token);} catch {
    // Missing, corrupt, cancelled or unuploaded evidence can never report green.
    result=null;
  }
  let state;
  try {
    const jobs=await api(publicEndpoint(`actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`));
    const verification=jobs.jobs.filter(row=>row.name==='Full private Reader verification');
    assert.equal(verification.length,1); assert.equal(verification[0].conclusion,job);
    state=reportState({result,value,job,run:actual,expectedRun:run,attempt,workflowId:workflow.id,live,latest});
  } catch { state={state:'error',description:`full invalid ${fingerprint(value)}`}; }
  if(!state)return 'SUPERSEDED';
  // Re-read after network/download work so an older run cannot overwrite a newer pending/result.
  const current=await latestStatus(api,value);
  if(current?.target_url!==url||current?.description!==latest.description)return 'SUPERSEDED';
  const now=await liveBinding(api,value);
  if(now.head!==value.head||now.base!==value.base)state={state:'error',description:`full superseded ${fingerprint(value)}`};
  await postStatus(api,value,state.state,state.description,url);
  return state.state;
}
export async function poll(api,workflow,{enabled=false}={}) {
  if(!enabled)return {dispatched:0,disabled:true};
  sha(workflow);
  const approved=await api(publicEndpoint(`git/ref/heads/${policy.workflowRef}`));
  assert.equal(approved.object.sha,workflow,'Review and update the dedicated verification pin first');
  const pulls=await api(endpoint('pulls?state=open&base=main&per_page=100'));
  assert(pulls.length<100,'Pagination required before enabling larger queues');
  const main=await api(endpoint('git/ref/heads/main'));
  const candidates=[{source:main.object.sha,pr:0},...pulls.filter(pr=>pr.head.repo?.full_name===SOURCE_REPOSITORY&&policy.trustedAssociations.includes(pr.author_association)).map(pr=>({source:pr.head.sha,pr:pr.number}))];
  let dispatched=0;
  for(const candidate of candidates) {
    let value;try {value=await resolveInput(api,{...candidate,workflow});} catch {continue;}
    const status=await latestStatus(api,value);
    if(!dispatchNeeded(status,value)) {
      if(status.state==='pending') {
        const match=status.target_url?.match(/^https:\/\/github\.com\/lwtlab\/reader\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/);
        if(match) {
          const run=await api(publicEndpoint(`actions/runs/${match[1]}`));
          if(run.status==='completed') await postStatus(api,value,'error',`full incomplete ${fingerprint(value)}`,status.target_url);
        }
      }
      continue;
    }
    await api(publicEndpoint(`actions/workflows/${WORKFLOW}/dispatches`),'POST',{ref:policy.workflowRef,inputs:{source_ref:value.head,pr_number:String(value.pr),workflow_sha:workflow}});
    dispatched++;
  }
  return {dispatched};
}
async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY,BUILD_REPOSITORY);sha(process.env.GITHUB_SHA);
  const api=github(process.env.GH_TOKEN);const command=process.argv[2];
  if(command==='poll') {
    assert.equal(process.env.GITHUB_REF,'refs/heads/main');
    console.log(JSON.stringify(await poll(api,process.env.VERIFICATION_WORKFLOW_SHA,{enabled:process.env.AUTOMATIC_VERIFICATION==='true'})));return;
  }
  if(command==='resolve') {
    assert.equal(process.env.GITHUB_REF,`refs/heads/${policy.workflowRef}`);
    assert.equal(process.env.WORKFLOW_SHA,process.env.GITHUB_SHA,'Executing workflow must match the requested immutable pin');
    const value=await resolveInput(api,{source:process.env.SOURCE_REF,pr:Number(process.env.PR_NUMBER||0),workflow:process.env.GITHUB_SHA});
    appendFileSync(process.env.GITHUB_OUTPUT,`binding=${JSON.stringify(value)}\ntested=${value.tested}\n`);
    await postStatus(api,value,'pending',`full pending ${fingerprint(value)}`,runUrl(process.env.GITHUB_RUN_ID,process.env.GITHUB_RUN_ATTEMPT));
    console.log('Trusted immutable verification input accepted');return;
  }
  assert.equal(command,'report');
  const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));
  console.log(`Verification status: ${await report(api,value,{run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT),job:process.env.VERIFICATION_JOB_RESULT,token:process.env.GH_TOKEN})}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{const code=/^HTTP_[1-5][0-9]{2}$/.test(error.code||'')?error.code:error.code==='ERR_ASSERTION'?'VALIDATION_ASSERTION':'CONTROLLER_ERROR';console.error(`Verification controller failed (${code}); no success status was issued`);process.exitCode=1;});
