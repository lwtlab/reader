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
  assert.deepEqual(Object.keys(input).sort(), [published ? 'baselineVersion' : 'baselineRun', 'candidateRun', 'toolingSha',...(input.workflowSha?['workflowSha']:[])].sort());
  assert.match(String(input.candidateRun), /^[1-9][0-9]{5,19}$/);
  if (published) assert.match(input.baselineVersion, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
  else assert.match(String(input.baselineRun), /^[1-9][0-9]{5,19}$/);
  assert.match(input.toolingSha, /^[a-f0-9]{40}$/);
  if(input.workflowSha)assert.match(input.workflowSha,/^[a-f0-9]{40}$/);
  return input;
}

export async function resolveAcceptance(input, target, request,executingWorkflowSha) {
  assert.match(target, /^(darwin-(arm64|x64)|win32-x64|linux-x64)$/);
  if(input.workflowSha)assert.equal(input.workflowSha,executingWorkflowSha,'Upgrade dispatch must pin the executing workflow');
  let candidate;
  for (const [role, id, jobName] of [
    ...(input.baselineVersion ? [] : [['baseline', input.baselineRun, `baseline-${target}`]]),
    ['candidate', input.candidateRun, `internal-${target}`],
  ]) {
    const run = await request(`actions/runs/${id}`);
    assert.equal(run.event, 'workflow_dispatch');
    assert.equal(run.path, '.github/workflows/desktop-candidates.yml');
    assert.equal(run.repository.full_name, 'lwtlab/reader');
    const jobs = await request(`actions/runs/${id}/jobs?per_page=100`);
    const legacy=jobs.jobs.some(job => job.name === jobName && job.conclusion === 'success');
    const producer=role==='candidate' && jobs.jobs.some(job=>job.name===`release-desktop-${target}` && job.conclusion==='success');
    assert.ok(legacy!==producer,`${role} must have exactly one successful native producer generation`);
    if(producer){assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.match(run.head_sha,/^[a-f0-9]{40}$/);assert.ok(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0);}
    const name = producer ? `reader-release-desktop-${target}-packages` : `reader-${role === 'candidate' ? 'internal-' : ''}${target}-candidate`;
    const artifacts = await request(`actions/runs/${id}/artifacts?per_page=100`);
    const matches = artifacts.artifacts.filter(artifact => artifact.name === name && !artifact.expired);
    assert.equal(matches.length, 1, 'One unexpired immutable artifact is required');
    if(role==='candidate'){
      candidate={candidateKind:producer?'producer':'legacy',candidateArtifact:name};
      if(producer){
        const receipts=artifacts.artifacts.filter(a=>a.name===`reader-release-desktop-${target}-receipt`&&!a.expired);
        assert.equal(receipts.length,1,'One native receipt artifact required');
        for(const artifact of [matches[0],receipts[0]]){assert.ok(Number.isSafeInteger(artifact.id)&&artifact.id>0);assert.match(artifact.digest,/^sha256:[a-f0-9]{64}$/);}
        Object.assign(candidate,{candidateArtifactId:matches[0].id,candidateReceiptId:receipts[0].id,candidateWorkflowSha:run.head_sha,candidateAttempt:run.run_attempt});
      }
    }
  }
  return {...input,...candidate};
}

export function nativeProducerProvenance(receipt,index,{sourceSha,runId,artifactId,workflowSha,attempt}){
 assert.equal(receipt.schemaVersion,1);assert.equal(receipt.kind,'reader-release-target');
 assert.equal(receipt.sourceSha,sourceSha);assert.equal(receipt.version,index.version);
 assert.equal(receipt.target,`desktop-${index.platform}-${index.arch}`);
 assert.equal(receipt.delivery.repository,'lwtlab/reader');
 assert.equal(String(receipt.delivery.runId),String(runId));
 assert.equal(receipt.delivery.artifactId,Number(artifactId));
 assert.equal(receipt.delivery.workflowSha,workflowSha);assert.equal(receipt.delivery.attempt,Number(attempt));
 const payloads=index.artifacts.filter(a=>/\.(dmg|zip|exe|deb|AppImage)$/.test(a.name));
 assert.equal(payloads.length,2);assert.equal(receipt.artifacts.length,2);
 for(const a of receipt.artifacts){const original=payloads.find(p=>p.name===a.originalBuildName);assert.ok(original);assert.equal(original.sha256,a.sha256);assert.equal(original.bytes,a.bytes);}
 return {source:{commit:receipt.sourceSha},delivery:receipt.delivery,toolingSha:receipt.toolingSha,desktopAcceptance:receipt.desktopAcceptance};
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
  const resolved=await resolveAcceptance(input, process.env.BUILD_TARGET, async endpoint => {
    const response = await fetch(`https://api.github.com/repos/lwtlab/reader/${endpoint}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    assert.ok(response.ok, 'GitHub evidence lookup failed');
    return response.json();
  },process.env.GITHUB_SHA);
  appendFileSync(process.env.GITHUB_OUTPUT, `tooling_sha=${input.toolingSha}\nbaseline_run=${input.baselineRun || ''}\nbaseline_version=${input.baselineVersion || ''}\ntransition_flag=${input.baselineVersion ? '' : '--allow-core-to-bundled-speech'}\ncandidate_run=${input.candidateRun}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT,`candidate_kind=${resolved.candidateKind}\ncandidate_artifact=${resolved.candidateArtifact}\ncandidate_artifact_id=${resolved.candidateArtifactId||''}\ncandidate_receipt_id=${resolved.candidateReceiptId||''}\ncandidate_workflow_sha=${resolved.candidateWorkflowSha||''}\ncandidate_attempt=${resolved.candidateAttempt||''}\n`);
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
  const input = parseAcceptance(process.env.ACCEPTANCE_JSON);
  const provenance = process.env.CANDIDATE_KIND==='producer'
   ? nativeProducerProvenance(JSON.parse(readFileSync(path.join('candidate-receipt','release-target.json'))),next,{sourceSha:process.env.SOURCE_REF,runId:input.candidateRun,artifactId:process.env.CANDIDATE_ARTIFACT_ID,workflowSha:process.env.CANDIDATE_WORKFLOW_SHA,attempt:process.env.CANDIDATE_ATTEMPT})
   : JSON.parse(readFileSync(path.join(candidateDir, 'internal-candidate-provenance.json'), 'utf8'));
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
    boundaries: ['Native candidate packages; signing is independently checked by the producer', 'Synthetic QA profile on disposable native runner', input.baselineVersion ? 'Baseline uses actual released binary IDs and SHA256' : 'Baseline rebuilt from historical source; not a historical released binary', 'Only manual installer upgrade tested; automatic updates not exercised'],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log('Recorded native installer upgrade with immutable artifact digests');
}
