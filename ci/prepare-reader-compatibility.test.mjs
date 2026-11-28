import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {prepareReaderCompatibility} from './prepare-reader-compatibility.mjs';
function source(t,scripts) {
  const root=mkdtempSync(path.join(tmpdir(),'reader-compat-source-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,'apps/reader'),{recursive:true});
  writeFileSync(path.join(root,'apps/reader/package.json'),JSON.stringify({scripts}));
  return root;
}
test('older source without preparation keeps the original checks and runs no replacement command',t=>{
  assert.deepEqual(prepareReaderCompatibility(source(t,{}),()=>assert.fail('must not install')),{status:'NOT_DECLARED'});
});
test('declared preparation runs only the fixed pnpm entry in the exact checked-out source',t=>{
  const root=source(t,{'prepare:sync-compatibility':'source-owned script'}),calls=[];
  assert.deepEqual(prepareReaderCompatibility(root,(...args)=>calls.push(args)),{status:'PREPARED'});
  assert.deepEqual(calls,[['pnpm',['--dir','apps/reader','prepare:sync-compatibility'],{cwd:root,stdio:'inherit'}]]);
});
test('empty declarations and failed preparation cannot return success',t=>{
  assert.throws(()=>prepareReaderCompatibility(source(t,{'prepare:sync-compatibility':''}),()=>assert.fail()));
  assert.throws(()=>prepareReaderCompatibility(source(t,{'prepare:sync-compatibility':'declared'}),()=>{throw Error('synthetic frozen install failed');}),/synthetic frozen install failed/);
});
