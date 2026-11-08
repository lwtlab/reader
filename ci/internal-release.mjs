import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseInputs(raw, source, workflowSha) {
  assert.match(source, /^[a-f0-9]{40}$/);
  const value = JSON.parse(raw);
  assert.deepEqual(Object.keys(value).sort(), ['plan', 'publish', 'workflowSha', ...(value.resume ? ['resume'] : [])].sort());
  assert.equal(value.workflowSha, workflowSha, 'Dispatch must pin the executing public workflow commit');
  assert.match(value.workflowSha, /^[a-f0-9]{40}$/);
  assert.match(value.plan, /^release\/ci\/[a-zA-Z0-9._/-]+\.json$/);
  assert.ok(value.plan.split('/').every(p => p && p !== '.' && p !== '..'));
  assert.equal(typeof value.publish, 'boolean');
  if (value.resume) {
    assert.deepEqual(Object.keys(value.resume).sort(), ['attempt', 'run']);
    assert.ok(Number.isSafeInteger(value.resume.run) && value.resume.run > 0);
    assert.ok(Number.isSafeInteger(value.resume.attempt) && value.resume.attempt > 0);
  }
  return value;
}

export function exportSessions(input, output) {
  mkdirSync(output, { recursive: true });
  for (const part of ['application', 'archive']) {
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
    appendFileSync(process.env.GITHUB_OUTPUT, `plan=${v.plan}\npublish=${v.publish}\nresume_run=${v.resume?.run || ''}\nresume_attempt=${v.resume?.attempt || ''}\n`);
  }
}
