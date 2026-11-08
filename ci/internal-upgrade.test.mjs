import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAcceptance, resolveAcceptance } from './internal-upgrade.mjs';

test('upgrade inputs require immutable tooling and numeric artifact run IDs', () => {
  const input = { baselineRun: '42449632255', candidateRun: '234567', toolingSha: 'a'.repeat(40) };
  assert.deepEqual(parseAcceptance(JSON.stringify(input)), input);
  for (const bad of [{...input, toolingSha: 'main'}, {...input, candidateRun: '../x'}, {...input, extra: true}])
    assert.throws(() => parseAcceptance(JSON.stringify(bad)));
});
test('upgrade artifacts require successful native jobs and unexpired exact named artifacts', async () => {
  const input = { baselineRun: '42449632255', candidateRun: '234567', toolingSha: 'a'.repeat(40) };
  const request = async endpoint => {
    const candidate = endpoint.includes('234567');
    if (endpoint.includes('/jobs?')) return {jobs: [{name: candidate ? 'internal-linux-x64' : 'linux-x64', conclusion: 'success'}]};
    if (endpoint.includes('/artifacts?')) return {artifacts: [{name: `reader-${candidate ? 'internal-' : ''}linux-x64-candidate`, expired: false}]};
    return {event: 'workflow_dispatch', path: '.github/workflows/desktop-candidates.yml', head_sha: 'd5f8a4a24df7897244ea3ba300f3ae2c4dd8c5d2', repository: {full_name: 'lwtlab/reader'}};
  };
  await resolveAcceptance(input, 'linux-x64', request);
  await assert.rejects(resolveAcceptance(input, 'linux-x64', async endpoint => endpoint.includes('/artifacts?') ? {artifacts: []} : request(endpoint)));
});
