import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
const execute = promisify(execFile);
test('captured Xvfb failure retains diagnostics, exit status and removes its temporary files', { skip: process.platform === 'win32' }, async () => {
  const root=mkdtempSync(path.join(os.tmpdir(),'reader-xvfb-contract-'));
  try {
    const bin=path.join(root,'bin'), temp=path.join(root,'temp');mkdirSync(bin);mkdirSync(temp);
    writeFileSync(path.join(bin,'xvfb-run'), `#!${process.execPath}\nconst fs=require('node:fs');const file=process.argv.find(x=>x.startsWith('--error-file=')).slice('--error-file='.length);fs.writeFileSync(file,'synthetic X server failure\\n');console.log('synthetic application output');process.exit(7);\n`, { mode:0o700 });
    await assert.rejects(execute('bash',[fileURLToPath(new URL('./run-xvfb.sh',import.meta.url)),'unused'],{env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,RUNNER_TEMP:temp}}), error => {
      assert.equal(error.code,7);assert.match(error.stdout,/synthetic application output/);assert.match(error.stderr,/synthetic X server failure/);return true;
    });
    assert.deepEqual(readdirSync(temp),[]);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
