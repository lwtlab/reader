import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {github,resolveInput,liveBinding} from './reader-verification-control.mjs';
import {binding,positive,BUILD_REPOSITORY,SOURCE_REPOSITORY,WORKFLOW} from './reader-verification.mjs';
import {profiles,fingerprint} from './reader-reliability-verification.mjs';
import {discoveryInput,latest,pending,reportReliability} from './reader-reliability-control.mjs';

export const CHECKS_REF='ci/reader-checks-20261118';
export const CHECKS_PROFILES=Object.freeze(['public-integration','release-privacy']);
const source=p=>`repos/${SOURCE_REPOSITORY}/${p}`,pub=p=>`repos/${BUILD_REPOSITORY}/${p}`;
const trusted=['OWNER','MEMBER','COLLABORATOR'];
export function checkProfile(p){assert(CHECKS_PROFILES.includes(p),'Unknown independent check');return p;}

export async function pollChecks(api,workflow,{enabled=false}={}){
  if(!enabled)return {disabled:true,dispatched:0};
  assert.match(workflow,/^[a-f0-9]{40}$/);
  assert.equal((await api(pub(`git/ref/heads/${CHECKS_REF}`))).object.sha,workflow);
  const pulls=await api(source('pulls?state=open&base=main&per_page=100'));
  assert(Array.isArray(pulls)&&pulls.length<100,'Discovery pagination required');
  const main=await api(source('git/ref/heads/main'));
  const candidates=[{source:main.object.sha,pr:0},...pulls.filter(p=>p.head.repo?.full_name===SOURCE_REPOSITORY&&trusted.includes(p.author_association)).map(p=>({source:p.head.sha,pr:p.number}))];
  let dispatched=0;
  for(const candidate of candidates){
    let value;
    try{value=await resolveInput(discoveryInput(api,candidate),{...candidate,workflow});}
    catch(error){if(['MERGE_NOT_READY','RELIABILITY_INPUT_INELIGIBLE'].includes(error.code))continue;throw error;}
    // Both checks are mandatory for every supported source. Missing commands fail
    // in the executor; path metadata or missing files cannot silently waive them.
    for(const profile of CHECKS_PROFILES){
      const status=await latest(api,value,profile),id=fingerprint(value,profile);
      if(status?.description?.endsWith(` ${id}`)){
        if(status.state==='pending'){
          const match=status.target_url?.match(/^https:\/\/github\.com\/lwtlab\/reader\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/);
          if(match){
            const run=await api(pub(`actions/runs/${match[1]}`));
            if(run.status==='completed'){
              const [current,live]=await Promise.all([latest(api,value,profile),liveBinding(api,value)]);
              if(current?.state==='pending'&&current.target_url===status.target_url&&current.description===status.description&&live.head===value.head&&live.base===value.base){
                await api(source(`statuses/${value.head}`),'POST',{state:'error',context:profiles[profile].context,description:`reliability incomplete ${id}`,target_url:status.target_url});
              }
            }
          }
        }
        continue;
      }
      const live=await liveBinding(api,value);
      if(live.head!==value.head||live.base!==value.base)continue;
      await api(pub(`actions/workflows/${WORKFLOW}/dispatches`),'POST',{ref:CHECKS_REF,inputs:{source_ref:value.head,pr_number:String(value.pr),workflow_sha:workflow,scope:profile}});
      dispatched++;
    }
  }
  return {dispatched};
}

async function main(){
  assert.equal(process.env.GITHUB_REPOSITORY,BUILD_REPOSITORY);
  const api=github(process.env.GH_TOKEN),command=process.argv[2];
  if(command==='poll'){
    assert(['refs/heads/main',`refs/heads/${CHECKS_REF}`].includes(process.env.GITHUB_REF));
    console.log(JSON.stringify(await pollChecks(api,process.env.CHECKS_WORKFLOW_SHA,{enabled:process.env.CHECKS_AUTOMATIC==='true'})));return;
  }
  assert.equal(process.env.GITHUB_REF,`refs/heads/${CHECKS_REF}`);
  assert.equal(process.env.WORKFLOW_SHA,process.env.GITHUB_SHA);
  const profile=checkProfile(process.env.RELIABILITY_PROFILE);
  const options={profile,run:positive(process.env.GITHUB_RUN_ID),attempt:positive(process.env.GITHUB_RUN_ATTEMPT)};
  if(command==='resolve'){
    assert.equal((await api(pub(`git/ref/heads/${CHECKS_REF}`))).object.sha,process.env.GITHUB_SHA);
    const value=await resolveInput(api,{source:process.env.SOURCE_REF,pr:Number(process.env.PR_NUMBER||0),workflow:process.env.GITHUB_SHA});
    await pending(api,value,options);
    appendFileSync(process.env.GITHUB_OUTPUT,`binding=${JSON.stringify(value)}\ntested=${value.tested}\n`);
    console.log('Trusted immutable independent-check input accepted');return;
  }
  assert.equal(command,'report');
  const value=binding(JSON.parse(process.env.VERIFICATION_BINDING));assert.equal(value.workflow,process.env.GITHUB_SHA);
  console.log(`Independent check status: ${await reportReliability(api,value,{...options,job:process.env.VERIFICATION_JOB_RESULT,token:process.env.GH_TOKEN})}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Independent-check controller failed; no success status issued');process.exitCode=1;});
