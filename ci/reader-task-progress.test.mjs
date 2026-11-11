import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { taskEvent, taskProgress } from './reader-task-progress.mjs';
import { TASKS, resultFromSummary } from './reader-verification.mjs';
const value = { head: 'a'.repeat(40), base: 'b'.repeat(40), tested: 'c'.repeat(40), pr: 1, workflow: 'd'.repeat(40) };
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'reader-progress-')); t.after(() => rmSync(root, { force: true, recursive: true }));
  const directory = path.join(root, 'source/.artifacts/verify', 'a'.repeat(36)); mkdirSync(directory, { recursive: true });
  const env = { VERIFICATION_BINDING: JSON.stringify(value), GITHUB_SHA: value.workflow, GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '2', READER_PREPARATION_STARTED_MS: '1000' };
  return { root, env, file: path.join(directory, 'progress.jsonl') };
}
test('only fixed public task fields pass, never private reason/output or unknown IDs', () => {
  assert.deepEqual(taskEvent({ id: 'reader-unit', status: 'PASS', durationMs: 12, output: 'secret' }), { id: 'reader-unit', status: 'PASS', durationMs: 12 });
  for (const input of [{ id: 'private-file' }, { status: 'REUSED' }, { durationMs: NaN }, { durationMs: -1 }, { durationMs: 1e15 }]) assert.equal(taskEvent({ id: 'reader-unit', status: 'PASS', durationMs: 0, ...input }), null);
});
test('progress is bounded, ordered, immutable-bound and cannot qualify an incomplete result', t => {
  const f = fixture(t), lines = [];
  const p = taskProgress({ ...f, emit: line => lines.push(line), now: () => 2000 });
  writeFileSync(f.file, JSON.stringify({ id: 'reader-unit', status: 'RUNNING', durationMs: 0, reason: 'secret' }) + '\n'); p.flush(); p.flush();
  appendFileSync(f.file, JSON.stringify({ id: 'reader-unit', status: 'PASS', durationMs: 100, reason: 'secret' })); p.flush(); assert.equal(lines.length, 1);
  appendFileSync(f.file, '\n'); p.flush(); p.flush();
  const report = p.finish(); assert.equal(lines.length, 2); assert(!lines.join('').includes('secret'));
  assert.equal(report.authoritative, false); assert.deepEqual(report.binding, value); assert.equal(report.run, 10); assert.equal(report.attempt, 2);
  assert.equal(report.preparationDurationMs, 1000); assert.equal(report.tasks.length, 1);
  assert.equal(resultFromSummary(report, value, 'success', Buffer.from('progress')).status, 'FAIL');
  assert.throws(() => taskProgress({ root: f.root, env: { ...f.env, GITHUB_SHA: 'e'.repeat(40) } }));
});
test('unexecuted PASS, symlinks and oversized input cannot become observed progress', t => {
  const f = fixture(t), lines = [], p = taskProgress({ ...f, emit: line => lines.push(line) });
  writeFileSync(f.file, JSON.stringify({ id: TASKS[0], status: 'PASS', durationMs: 1 }) + '\n'); p.flush(); assert.equal(lines.length, 0);
  writeFileSync(f.file, 'x'.repeat(65537)); p.flush(); assert.equal(lines.length, 0);
  rmSync(f.file); const outside = path.join(f.root, 'private'); writeFileSync(outside, JSON.stringify({ id: TASKS[0], status: 'RUNNING', durationMs: 0 }) + '\n');
  symlinkSync(outside, f.file); p.flush(); assert.equal(lines.length, 0);
});
test('actual private-step emits allowlisted progress while the child runs and preserves failure', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const script = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(f.file)},JSON.stringify({id:'reader-unit',status:'RUNNING',durationMs:0,reason:'PRIVATE-CONTENT'})+'\\n');console.log('PRIVATE-STDOUT');console.error('PRIVATE-STDERR');setTimeout(()=>{fs.appendFileSync(${JSON.stringify(f.file)},JSON.stringify({id:'reader-unit',status:'PASS',durationMs:2000})+'\\n');process.exit(7)},2500);`;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./private-step.mjs', import.meta.url)), 'full-verification', 'source', process.execPath, '-e', script], { cwd: f.root, env: { ...process.env, ...f.env, RUNNER_TEMP: f.root }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '', live = false;
  child.stdout.on('data', bytes => { output += bytes; if (output.includes('RUNNING') && child.exitCode === null) live = true; });
  child.stderr.on('data', bytes => { output += bytes; });
  const status = await new Promise(resolve => child.once('close', resolve));
  assert.equal(status, 1); assert.equal(live, true); assert(!output.includes('PRIVATE-'));
  assert.match(readFileSync(path.join(f.root, 'reader-private-build.log'), 'utf8'), /PRIVATE-STDOUT/);
  const report = JSON.parse(readFileSync(path.join(f.root, 'verification-output/progress.json')));
  assert.equal(report.authoritative, false); assert.equal(report.tasks[0].status, 'PASS');
});
