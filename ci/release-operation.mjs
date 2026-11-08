import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { releaseInputs } from './internal-release.mjs';
const input=releaseInputs(process.env.RELEASE_JSON,process.env.SOURCE_REF,process.env.GITHUB_SHA);
const operation=input.operation||'publish';
if (operation==='build') throw new Error('Builds run in isolated native producer jobs without the publication token');
const base=process.env.RUNNER_TEMP;
const state=path.join(base,'reader-release-session'), bundle=path.join(base,'reader-release-candidate');
const receipt=path.join(base,'reader-release-collection.json'), report=path.join(base,'reader-release-result.json');
const resume=input.resume?['--resume-run',String(input.resume.run),'--resume-attempt',String(input.resume.attempt)]:[];
function invoke(name,args) {
  const result=spawnSync(process.execPath,['ci/private-step.mjs',name,'source',process.execPath,'scripts/release-actions.mjs',...args],{env:process.env,stdio:'inherit'});
  if(result.status!==0) process.exit(result.status||1);
}
if (operation==='smoke') {
  invoke('recovery-smoke',['smoke','--stage',input.resume?'resume':'seed','--state',path.join(state,'smoke'),'--receipt',report,...resume]);
} else {
  // Recovery verifies every restored byte against the protected plan; it does not require expired Actions inputs.
  if (!input.resume) invoke('preflight',['preflight','--plan',input.plan,'--report',report]);
  if (operation!=='probe') {
    invoke('collect',['collect','--plan',input.plan,'--output',bundle,'--receipt',receipt,...resume]);
    invoke(operation,[operation,'--plan',input.plan,'--bundle',bundle,'--receipt',receipt,'--state',state,...(operation==='publish'?['--publish',String(input.publish)]:[]),'--report',report,...resume]);
  }
}
