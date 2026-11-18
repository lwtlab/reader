// Resolve trusted PR identity; product membership stays in the pinned private planner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {binding,positive,verifyMergeParents} from './reader-verification.mjs';
export const PULL_POLICY=JSON.parse(readFileSync(new URL('./selected-pull-policy.json',import.meta.url)));
export const PULL_CASE='pull-request';
export function pullRequest(input){
 const value=binding({...input,tested:input.head});positive(value.pr);assert.notEqual(value.head,value.base);
 return {head:value.head,base:value.base,pr:value.pr,workflow:value.workflow};
}
export async function resolveSelectedPull(api,input,policy=PULL_POLICY){
 const expected=pullRequest(input);assert.equal(policy.schemaVersion,1);assert.equal(policy.activation,'explicit-selected-pr-only');assert.equal(policy.sourceRepository,'lwtlab/lwt-core');
 const prefix=`repos/${policy.sourceRepository}/`,pull=await api(prefix+`pulls/${expected.pr}`);
 assert.equal(pull.number,expected.pr);assert.equal(pull.state,'open');assert.equal(pull.head.repo.full_name,policy.sourceRepository);assert.equal(pull.base.repo.full_name,policy.sourceRepository);
 assert(policy.trustedAssociations.includes(pull.author_association));assert.equal(pull.head.sha,expected.head);assert(policy.baseBranches.includes(pull.base.ref));assert.equal(pull.mergeable,true);
 const live=await api(prefix+`git/ref/heads/${pull.base.ref}`);assert.equal(live.object.sha,expected.base);
 const value=binding({...expected,tested:pull.merge_commit_sha});assert.notEqual(value.tested,value.head);assert.notEqual(value.tested,value.base);
 verifyMergeParents(await api(prefix+`git/commits/${value.tested}`),value);return value;
}
