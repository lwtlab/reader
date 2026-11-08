import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const sha = async file => {
  const sum = createHash('sha256');
  for await (const chunk of createReadStream(file)) sum.update(chunk);
  return sum.digest('hex');
};
const plan = JSON.parse(readFileSync('release/ci/0.25.0-rehearsal/plan.json'));
const inputs = plan.inputs.filter(i => i.kind === 'actions');
assert.equal(inputs.length, 2);
const output = path.join(process.env.RUNNER_TEMP, 'reader-archive-transport');
await mkdir(output);
let count = 0;
for (const input of inputs) {
  assert.equal(input.repository, 'lwtlab/reader');
  assert.ok(Number.isSafeInteger(input.artifactId));
  const archive = path.join(output, `${input.artifactId}.zip`);
  const fd = openSync(archive, 'wx', 0o600);
  try {
    execFileSync('gh', ['api', `repos/lwtlab/reader/actions/artifacts/${input.artifactId}/zip`, '-H', 'Accept: application/vnd.github+json'], {stdio: ['ignore', fd, 'pipe'], timeout: 15 * 60 * 1000});
  } finally { closeSync(fd); }
  assert.equal(await sha(archive), input.sha256);
  const selection = path.join(output, 'selection.json');
  writeFileSync(selection, JSON.stringify(input.files));
  execFileSync('python3', ['scripts/release/actions-zip.py', archive, selection, output], {stdio: 'pipe'});
  count += input.files.length;
  await rm(archive);
}
writeFileSync(path.join(process.env.RUNNER_TEMP, 'reader-transport-probe.json'), JSON.stringify({kind: 'synthetic-release-archive-transport', status: 'PASS', archives: inputs.length, files: count, sourceSha: plan.sourceSha}));
