import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {releaseInputs} from './internal-release.mjs';
const request=releaseInputs(process.env.RELEASE_JSON,process.env.SOURCE_REF,process.env.GITHUB_SHA);
if(request.operation!=='build')throw new Error('Explicit build dispatch required');
if(process.argv[2]==='receipt'){
 const file=process.argv[3], value=JSON.parse(readFileSync(file));
 if(value.target!==process.env.RELEASE_TARGET || value.sourceSha!==request.applicationSource)throw new Error('Producer receipt differs from requested application source');
 const id=Number(process.env.PACKAGE_ARTIFACT_ID);if(!Number.isSafeInteger(id)||id<=0)throw new Error('Completed Actions upload ID required');
 value.delivery={repository:'lwtlab/reader',runId:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),workflow:'.github/workflows/desktop-candidates.yml',workflowSha:process.env.GITHUB_SHA,artifactId:id};
 writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);
}else{
 const {producerMatrix}=await import(path.resolve('tooling/scripts/release/producer.mjs'));
 appendFileSync(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(producerMatrix(request.targets))}\ndesktop_matrix=${JSON.stringify(producerMatrix(request.targets).filter(row=>row.target.startsWith('desktop-')))}\napplication_source=${request.applicationSource}\n`);
}
