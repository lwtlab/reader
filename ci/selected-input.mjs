import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {binding,positive,verifyMergeParents} from './reader-verification.mjs';
export const MANIFEST=JSON.parse(readFileSync(new URL('./selected-examples.json',import.meta.url)));
export function exampleFor(id,manifest=MANIFEST){
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.publicBranch,'ci/selected-execution-20261113');assert.deepEqual(manifest.examples.map(e=>e.id),['implementation','reader-only','hear-only','shared-core','unknown']);const example=manifest.examples.find(e=>e.id===id);assert(example);assert(/^[a-f0-9]{40}$/.test(example.head)&&/^[a-f0-9]{40}$/.test(example.base));positive(example.pr);assert(/^[a-f0-9]{64}$/.test(example.changesSha256));assert.deepEqual(example.products,id==='reader-only'?['reader']:id==='hear-only'?['hear']:['reader','hear']);return example;
}
export async function resolveSelected(api,id,workflow,manifest=MANIFEST){
 const example=exampleFor(id,manifest);assert(/^[a-f0-9]{40}$/.test(workflow));const [pull,base]=await Promise.all([api(`repos/lwtlab/lwt-core/pulls/${example.pr}`),api(`repos/lwtlab/lwt-core/git/ref/heads/${example.baseBranch}`)]);
 assert.equal(base.object.sha,example.base);assert.equal(pull.state,'open');assert.equal(pull.number,example.pr);assert.equal(pull.head.repo.full_name,'lwtlab/lwt-core');assert.equal(pull.base.repo.full_name,'lwtlab/lwt-core');assert.equal(pull.head.ref,example.branch);assert.equal(pull.head.sha,example.head);assert.equal(pull.base.ref,example.baseBranch);assert(['OWNER','MEMBER','COLLABORATOR'].includes(pull.author_association));assert.equal(pull.mergeable,true);
 const value=binding({head:example.head,base:example.base,tested:pull.merge_commit_sha,pr:example.pr,workflow});assert(value.head!==value.base&&value.tested!==value.head&&value.tested!==value.base);verifyMergeParents(await api(`repos/lwtlab/lwt-core/git/commits/${value.tested}`),value);return value;
}
export function checkExamplePlan(record,id,manifest=MANIFEST){const expected=exampleFor(id,manifest);assert.equal(record.selection.changeMetadata,'complete');assert.equal(record.selection.changesSha256,expected.changesSha256);assert.deepEqual(record.selection.products,expected.products);return record;}
