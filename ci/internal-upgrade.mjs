import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const historicalSourceSha = '4d4a44876e9833bae0c9d1120b588623f5a46ea8';

export function parseAcceptance(value) {
  const input = JSON.parse(value);
  const published = Object.hasOwn(input, 'baselineVersion');
  assert.deepEqual(Object.keys(input).sort(), [published ? 'baselineVersion' : 'baselineRun', 'candidateRun', 'toolingSha']);
  assert.match(String(input.candidateRun), /^[1-9][0-9]{5,19}$/);
  if (published) assert.match(input.baselineVersion, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
  else assert.match(String(input.baselineRun), /^[1-9][0-9]{5,19}$/);
  assert.match(input.toolingSha, /^[a-f0-9]{40}$/);
  return input;
}

export async function resolveAcceptance(input, target, request) {
  assert.match(target, /^(darwin-(arm64|x64)|win32-x64|linux-x64)$/);
  for (const [role, id, jobName] of [
    ...(input.baselineVersion ? [] : [['baseline', input.baselineRun, `baseline-${target}`]]),
    ['candidate', input.candidateRun, `internal-${target}`],
  ]) {
    const run = await request(`actions/runs/${id}`);
    assert.equal(run.event, 'workflow_dispatch');
    assert.equal(run.path, '.github/workflows/desktop-candidates.yml');
    assert.equal(run.repository.full_name, 'lwtlab/reader');
    const jobs = await request(`actions/runs/${id}/jobs?per_page=100`);
    assert.ok(jobs.jobs.some(job => job.name === jobName && job.conclusion === 'success'), `${role} native job must pass`);
    const name = `reader-${role === 'candidate' ? 'internal-' : ''}${target}-candidate`;
    const artifacts = await request(`actions/runs/${id}/artifacts?per_page=100`);
    const matches = artifacts.artifacts.filter(artifact => artifact.name === name && !artifact.expired);
    assert.equal(matches.length, 1, 'One unexpired immutable artifact is required');
  }
  return input;
}

export function restoreMissingBlockmaps(directory, generate) {
  const index = JSON.parse(readFileSync(path.join(directory, 'desktop-artifacts.json'), 'utf8'));
  for (const artifact of index.artifacts) {
    assert.equal(path.basename(artifact.name), artifact.name);
    const file = path.join(directory, artifact.name);
    if (existsSync(file)) continue;
    assert.ok(artifact.name.endsWith('.blockmap'), 'Only omitted deterministic blockmap metadata can be recovered');
    const payload = index.artifacts.find(row => row.name === artifact.name.slice(0, -9));
    assert.ok(payload, 'Indexed payload required');
    const input = path.join(directory, payload.name), before = readFileSync(input);
    assert.equal(createHash('sha256').update(before).digest('hex'), payload.sha256);
    try {
      generate(input, file);
      const bytes = readFileSync(file);
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, 'Regenerated metadata must exactly match original CI digest');
      assert.deepEqual(readFileSync(input), before, 'Payload bytes must remain unchanged');
    } catch (error) {
      if (existsSync(file)) unlinkSync(file);
      throw error;
    }
  }
}

function verifyIndex(directory) {
  const index = JSON.parse(readFileSync(path.join(directory, 'desktop-artifacts.json'), 'utf8'));
  for (const artifact of index.artifacts) {
    assert.equal(path.basename(artifact.name), artifact.name);
    const bytes = readFileSync(path.join(directory, artifact.name));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  }
  return index;
}

if (process.argv[2] === 'resolve') {
  const input = parseAcceptance(process.env.ACCEPTANCE_JSON);
  await resolveAcceptance(input, process.env.BUILD_TARGET, async endpoint => {
    const response = await fetch(`https://api.github.com/repos/lwtlab/reader/${endpoint}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    assert.ok(response.ok, 'GitHub evidence lookup failed');
    return response.json();
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `tooling_sha=${input.toolingSha}\nbaseline_run=${input.baselineRun || ''}\nbaseline_version=${input.baselineVersion || ''}\ntransition_flag=${input.baselineVersion ? '' : '--allow-core-to-bundled-speech'}\ncandidate_run=${input.candidateRun}\n`);
} else if (process.argv[2] === 'restore-blockmaps') {
  const [directory, source] = process.argv.slice(3);
  const require = createRequire(path.resolve(source, 'apps/reader/package.json'));
  const builder = require('app-builder-bin').appBuilderPath;
  restoreMissingBlockmaps(directory, (input, output) => execFileSync(builder, ['blockmap', '--input', input, '--output', output], { stdio: 'pipe' }));
  verifyIndex(directory);
  console.log('All candidate files match original CI digests, including deterministic metadata');
} else if (process.argv[2] === 'record') {
  const [baselineDir, candidateDir, sourceDir, output] = process.argv.slice(3);
  const previous = verifyIndex(baselineDir), next = verifyIndex(candidateDir);
  const provenance = JSON.parse(readFileSync(path.join(candidateDir, 'internal-candidate-provenance.json'), 'utf8'));
  const input = parseAcceptance(process.env.ACCEPTANCE_JSON);
  const historical = JSON.parse(readFileSync(path.join(baselineDir, input.baselineVersion ?
    'released-baseline-provenance.json' : 'historical-baseline-provenance.json'), 'utf8'));
  assert.equal(provenance.source.commit, process.env.SOURCE_REF);
  if (input.baselineVersion) {
    assert.equal(historical.kind, 'reader-published-baseline');
    assert.equal(historical.repository, 'lwtlab/lwt-core');
    assert.match(historical.sourceSha, /^[a-f0-9]{40}$/);
    assert.equal(historical.version, input.baselineVersion);
    assert.equal(historical.target, `desktop-${previous.platform}-${previous.arch}`);
    const catalog = JSON.parse(readFileSync(path.join(sourceDir, 'release/baselines', `${input.baselineVersion}.json`), 'utf8'));
    assert.equal(catalog.basis, 'actual-published-binaries');
    assert.equal(historical.releaseId, catalog.releaseId);
    assert.equal(historical.sourceSha, catalog.sourceSha);
    assert.equal(historical.catalogSha256, createHash('sha256').update(JSON.stringify(catalog)).digest('hex'));
    assert.deepEqual(catalog.targets.find(t => t.target === historical.target).index, previous);
    assert.equal(previous.profile, next.profile);
    assert.equal(previous.version, input.baselineVersion);
  } else {
    assert.equal(historical.sourceSha, historicalSourceSha);
    assert.equal(String(historical.delivery.runId), String(input.baselineRun));
    assert.equal(previous.profile, 'core'); assert.equal(previous.version, '0.1.13');
    assert.equal(next.profile, 'bundled-speech'); assert.equal(next.version, '0.25.0');
  }
  assert.deepEqual(historical.artifacts, previous.artifacts);
  assert.match(process.env.SOURCE_REF, /^[a-f0-9]{40}$/);
  assert.equal(String(provenance.delivery.runId), String(input.candidateRun));
  for (const index of [previous, next]) {
    assert.equal(index.platform, process.platform); assert.equal(index.arch, process.arch);
  }
  const toolingSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceDir, encoding: 'utf8' }).trim();
  assert.equal(toolingSha, input.toolingSha);
  const report = {
    kind: 'synthetic-release-validation', status: 'PASS', gate: 'upgrade', version: next.version,
    target: `desktop-${next.platform}-${next.arch}`, sourceSha: process.env.SOURCE_REF,
    artifactSha256: next.artifacts.filter(row => /\.(dmg|zip|exe|deb|AppImage)$/.test(row.name)).map(row => row.sha256).sort(),
    toolingSha, baseline: { sourceSha: historical.sourceSha, ...(input.baselineVersion ? {releaseId: historical.releaseId} : {runId: input.baselineRun}), version: previous.version, profile: previous.profile, artifacts: previous.artifacts, provenance: historical },
    candidate: provenance,
    delivery: { repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, workflowCommit: process.env.GITHUB_SHA },
    checks: { actualNativeInstallerUpgrade: 'PASS', syntheticLibraryNotesProgressAndPdfPreserved: 'PASS', postUpgradeWriteAndReopen: 'PASS', uninstallPreservesData: 'PASS', ...(input.baselineVersion ? {sameProfileReleasedBinaryUpgrade: 'PASS'} : {explicitCoreToBundledSpeechTransition: 'PASS'}) },
    boundaries: ['Unsigned CI candidates', 'Synthetic QA profile on disposable native runner', input.baselineVersion ? 'Baseline uses actual released binary IDs and SHA256' : 'Baseline rebuilt from historical source; not a historical released binary', 'Only manual installer upgrade tested; automatic updates not exercised'],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log('Recorded native installer upgrade with immutable artifact digests');
}
