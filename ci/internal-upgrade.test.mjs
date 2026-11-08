import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseAcceptance, resolveAcceptance, restoreMissingBlockmaps } from './internal-upgrade.mjs';

test('upgrade inputs require immutable tooling and numeric artifact run IDs', () => {
  const input = { baselineRun: '42449632255', candidateRun: '234567', toolingSha: 'a'.repeat(40) };
  assert.deepEqual(parseAcceptance(JSON.stringify(input)), input);
  for (const bad of [{...input, toolingSha: 'main'}, {...input, candidateRun: '../x'}, {...input, extra: true}])
    assert.throws(() => parseAcceptance(JSON.stringify(bad)));
});
test('omitted blockmaps can only be restored as the exact originally indexed bytes', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reader-map-restore-'));
  const row = (name, data) => ({name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')});
  const payload = Buffer.from('installer'), map = Buffer.from('original deterministic metadata');
  try {
    writeFileSync(path.join(directory, 'app.exe'), payload);
    writeFileSync(path.join(directory, 'desktop-artifacts.json'), JSON.stringify({artifacts: [row('app.exe', payload), row('app.exe.blockmap', map)]}));
    assert.throws(() => restoreMissingBlockmaps(directory, (_, output) => writeFileSync(output, 'changed metadata')));
    assert.equal(existsSync(path.join(directory, 'app.exe.blockmap')), false);
    restoreMissingBlockmaps(directory, (_, output) => writeFileSync(output, map));
    assert.equal(existsSync(path.join(directory, 'app.exe.blockmap')), true);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
test('upgrade artifacts require successful native jobs and unexpired exact named artifacts', async () => {
  const input = { baselineRun: '42449632255', candidateRun: '234567', toolingSha: 'a'.repeat(40) };
  const request = async endpoint => {
    const candidate = endpoint.includes('234567');
    if (endpoint.includes('/jobs?')) return {jobs: [{name: candidate ? 'internal-linux-x64' : 'baseline-linux-x64', conclusion: 'success'}]};
    if (endpoint.includes('/artifacts?')) return {artifacts: [{name: `reader-${candidate ? 'internal-' : ''}linux-x64-candidate`, expired: false}]};
    return {event: 'workflow_dispatch', path: '.github/workflows/desktop-candidates.yml', head_sha: 'd5f8a4a24df7897244ea3ba300f3ae2c4dd8c5d2', repository: {full_name: 'lwtlab/reader'}};
  };
  await resolveAcceptance(input, 'linux-x64', request);
  await assert.rejects(resolveAcceptance(input, 'linux-x64', async endpoint => endpoint.includes('/artifacts?') ? {artifacts: []} : request(endpoint)));
});


test('published baseline inputs use durable release catalogs and require no baseline Actions run', async () => {
  const input = {baselineVersion: '0.25.0', candidateRun: '234567', toolingSha: 'a'.repeat(40)};
  assert.deepEqual(parseAcceptance(JSON.stringify(input)), input);
  for (const value of ['../private', 'main', '0.25.0/path', '025.0.0'])
    assert.throws(() => parseAcceptance(JSON.stringify({...input, baselineVersion: value})));
  assert.throws(() => parseAcceptance(JSON.stringify({...input, baselineRun: '123456'})));
  const endpoints = [];
  await resolveAcceptance(input, 'darwin-x64', async endpoint => {
    endpoints.push(endpoint);
    if (endpoint.includes('/jobs?')) return {jobs: [{name: 'internal-darwin-x64', conclusion: 'success'}]};
    if (endpoint.includes('/artifacts?')) return {artifacts: [{name: 'reader-internal-darwin-x64-candidate', expired: false}]};
    return {event: 'workflow_dispatch', path: '.github/workflows/desktop-candidates.yml', repository: {full_name: 'lwtlab/reader'}};
  });
  assert.equal(endpoints.length, 3);
});
