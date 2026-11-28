import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function prepareReaderCompatibility(source,execute=execFileSync) {
  const pkg=JSON.parse(readFileSync(path.join(source,'apps/reader/package.json'),'utf8'));
  const declared=pkg.scripts?.['prepare:sync-compatibility'];
  // Older immutable inputs do not expose this preparation command. Their
  // original complete graph and lock checks still execute without changes.
  if(declared===undefined)return {status:'NOT_DECLARED'};
  assert(typeof declared==='string'&&declared.trim(),'Invalid compatibility preparation declaration');
  execute('pnpm',['--dir','apps/reader','prepare:sync-compatibility'],{cwd:source,stdio:'inherit'});
  return {status:'PREPARED'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length,2);
    console.log(JSON.stringify(prepareReaderCompatibility(process.cwd())));
  } catch {console.error('Historical dependency preparation failed; original verification remains required');process.exitCode=1;}
}
