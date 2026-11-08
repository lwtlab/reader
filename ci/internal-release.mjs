import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseInputs(raw, source, workflowSha) {
  assert.match(source, /^[a-f0-9]{40}$/);
  const value = JSON.parse(raw);
  const operation = value.operation || 'publish';
  assert.ok(['publish','protect','probe','smoke','build'].includes(operation));
  const allowed=['publish','workflowSha',...(value.operation?['operation']:[]),...(value.resume?['resume']:[]),...(['publish','protect','probe'].includes(operation)?['plan']:[]),...(operation==='build'?['applicationSource','targets']:[])];
  assert.deepEqual(Object.keys(value).sort(), allowed.sort());
  assert.equal(value.workflowSha, workflowSha, 'Dispatch must pin the executing public workflow commit');
  assert.match(value.workflowSha, /^[a-f0-9]{40}$/);
  if (value.plan) {
    assert.match(value.plan, /^release\/ci\/[a-zA-Z0-9._/-]+\.json$/);
    assert.ok(value.plan.split('/').every(p => p && p !== '.' && p !== '..'));
  }
  assert.equal(typeof value.publish, 'boolean');
  if (operation!=='publish') assert.equal(value.publish,false);
  if (operation==='build') {
    assert.match(value.applicationSource,/^[a-f0-9]{40}$/);
    assert.ok(Array.isArray(value.targets) && value.targets.length>0);
    const targets=['desktop-darwin-arm64','desktop-darwin-x64','desktop-linux-x64','desktop-win32-x64','mobile-ios','mobile-android','extension-chrome'];
    assert.ok(value.targets.every(t=> t==='all'||targets.includes(t)));
    assert.equal(new Set(value.targets).size,value.targets.length);
    assert.ok(!value.targets.includes('all')||value.targets.length===1);
  }
  if (value.resume) {
    assert.notEqual(operation,'build');
    assert.deepEqual(Object.keys(value.resume).sort(), ['attempt', 'run']);
    assert.ok(Number.isSafeInteger(value.resume.run) && value.resume.run > 0);
    assert.ok(Number.isSafeInteger(value.resume.attempt) && value.resume.attempt > 0);
  }
  return value;
}

export function exportSessions(input, output) {
  mkdirSync(output, { recursive: true });
  for (const part of ['application', 'archive', 'candidate', 'smoke']) {
    const file = path.join(input, part, 'session.json');
    if (!existsSync(file)) continue;
    const value = JSON.parse(readFileSync(file));
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.repository, 'lwtlab/lwt-core');
    assert.match(value.owner, /^[a-f0-9-]{36}$/);
    assert.match(value.fingerprint, /^[a-f0-9]{64}$/);
    const selected = Object.fromEntries(['schemaVersion', 'repository', 'owner', 'fingerprint', 'phase', 'releaseId', 'assets', 'url'].filter(k => value[k] !== undefined).map(k => [k, value[k]]));
    mkdirSync(path.join(output, part), { recursive: true });
    writeFileSync(path.join(output, part, 'session.json'), `${JSON.stringify(selected, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'state') exportSessions(process.argv[3], process.argv[4]);
  else {
    const v = releaseInputs(process.env.RELEASE_JSON, process.env.SOURCE_REF, process.env.GITHUB_SHA);
    appendFileSync(process.env.GITHUB_OUTPUT, `operation=${v.operation||'publish'}\nplan=${v.plan||''}\npublish=${v.publish}\nresume_run=${v.resume?.run || ''}\nresume_attempt=${v.resume?.attempt || ''}\n`);
  }
}
