import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {binding,positive,verifyMergeParents} from './reader-verification.mjs';
import {PULL_CASE,PULL_POLICY,resolveSelectedPull,pullRequest} from './selected-pull.mjs';
export const MANIFEST=JSON.parse(readFileSync(new URL('./selected-examples.json',import.meta.url)));
export function exampleFor(id,manifest=MANIFEST){
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.publicBranch,'ci/selected-execution-20261113');assert.deepEqual(manifest.examples.map(e=>e.id),['implementation','reader-only','hear-only','shared-core','unknown']);const example=manifest.examples.find(e=>e.id===id);assert(example);assert(/^[a-f0-9]{40}$/.test(example.head)&&/^[a-f0-9]{40}$/.test(example.base));positive(example.pr);assert(/^[a-f0-9]{64}$/.test(example.changesSha256));assert.deepEqual(example.products,id==='reader-only'?['reader']:id==='hear-only'?['hear']:['reader','hear']);return example;
}
export function selectedBranch(id,manifest=MANIFEST){return id===PULL_CASE?PULL_POLICY.publicBranch:manifest.publicBranch;}
export function selectedInput(value,id,manifest=MANIFEST){
 if(id===PULL_CASE){pullRequest(value);return value;}
 const example=exampleFor(id,manifest);assert.equal(value.head,example.head);assert.equal(value.base,example.base);assert.equal(value.pr,example.pr);return value;
}
export async function resolveSelected(api,id,workflow,manifest=MANIFEST,request){
 if(id===PULL_CASE){assert.equal(request.workflow,workflow);return resolveSelectedPull(api,request);}
 const example=exampleFor(id,manifest);assert(/^[a-f0-9]{40}$/.test(workflow));const [pull,base]=await Promise.all([api(`repos/lwtlab/lwt-core/pulls/${example.pr}`),api(`repos/lwtlab/lwt-core/git/ref/heads/${example.baseBranch}`)]);
 assert.equal(base.object.sha,example.base);assert.equal(pull.state,'open');assert.equal(pull.number,example.pr);assert.equal(pull.head.repo.full_name,'lwtlab/lwt-core');assert.equal(pull.base.repo.full_name,'lwtlab/lwt-core');assert.equal(pull.head.ref,example.branch);assert.equal(pull.head.sha,example.head);assert.equal(pull.base.ref,example.baseBranch);assert(['OWNER','MEMBER','COLLABORATOR'].includes(pull.author_association));assert.equal(pull.mergeable,true);
 const value=binding({head:example.head,base:example.base,tested:pull.merge_commit_sha,pr:example.pr,workflow});assert(value.head!==value.base&&value.tested!==value.head&&value.tested!==value.base);verifyMergeParents(await api(`repos/lwtlab/lwt-core/git/commits/${value.tested}`),value);return value;
}
export function checkExamplePlan(record,id,manifest=MANIFEST){
 if(id===PULL_CASE){selectedInput(record.binding,id,manifest);assert(['complete','missing','invalid'].includes(record.selection.changeMetadata));if(record.selection.changeMetadata!=='complete')assert.deepEqual(record.selection.products,['reader','hear']);return record;}
 const expected=exampleFor(id,manifest);assert.equal(record.selection.changeMetadata,'complete');assert.equal(record.selection.changesSha256,expected.changesSha256);assert.deepEqual(record.selection.products,expected.products);return record;
}
