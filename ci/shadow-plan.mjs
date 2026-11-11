// Optional qualification only. Never executes or satisfies product gates.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { TASKS, binding, digest, positive } from './reader-verification.mjs';
import { encryptLog } from './log-crypto.mjs';

export const POLICY = 'reader-hear-shadow-v2';
export const EXTRA_TASKS = ['hear-tools','hear-types','hear-unit','core-sources','core-asr-controls','hear-native','hear-gui'];
export const RELEASE_GATES = ['reader-signed-installation','hear-signed-installation','hear-model-recovery','hear-physical-audio'];
export const CONTROL_CLASSES = ['reader-only','hear-only','shared-core','unknown'];
// Independently reviewed pins; private implementation bytes never enter this repository.
export const PINS = {
  "catalogSha256": "cfd40bda86e372e52405ac108cdd24942e590caa01b74ffd265bc0a76e25d094",
  "implementation": {
    "scripts/verification-catalog.mjs": "98b19c611bc5e7cea65d4d18692c8ffa0e496f1bc12bac1c73e1b62cc423f028",
    "scripts/verification-catalog.test.mjs": "88438cb7ea68a7b6ecaa23c531e3a7297c721dbd813f43f67714ab3257e787c1",
    "scripts/verify-tasks.mjs": "cc313515d0d43ee84584a8b665c9361934b842bfc195d2c9fae3f135f6f5079d",
    "scripts/verify-runtime.mjs": "b3327f03b71247d8f56314b878544a2f2009a7ef621b1af967988f3166f8d528"
  }
};
export function planIdentity(value, run, attempt) {
  const bound = binding(value);
  return { head: bound.head, base: bound.base, merge: bound.tested, workflow: bound.workflow, run: positive(run), attempt: positive(attempt) };
}
export function planResult(bytes, value, run, attempt, outcomes, pins = PINS) {
  const identity = planIdentity(value, run, attempt);
  const outcome = key => ['success','failure','cancelled','skipped'].includes(outcomes?.[key]) ? outcomes[key] : 'unknown';
  const result = {
    schemaVersion: 1, kind: 'reader-hear-shadow-plan-qualification', binding: binding(value), run: identity.run, attempt: identity.attempt,
    policy: POLICY, profile: 'full', shadowOnly: true, selectionApplied: false, status: 'FAIL', validation: 'FAIL',
    catalogSha256: pins.catalogSha256, summarySha256: null, planSha256: null, changesSha256: null,
    changeMetadata: 'unvalidated', products: ['reader','hear'], plannedTasks: [],
    controls: CONTROL_CLASSES.map(id => ({ id, kind: 'generated-git-control', status: 'NOT_RUN' })),
    execution: { controls: outcome('controls'), plan: outcome('plan') },
    mandatoryReaderTasks: TASKS.map(id => ({ id, status: 'NOT_RUN' })),
    releaseGates: RELEASE_GATES.map(id => ({ id, status: 'NOT_RUN' })),
    acceptance: { sourceExecution: 'NOT_RUN', nativeCompilation: 'NOT_RUN', scriptedGui: 'NOT_RUN', modelInference: 'NOT_RUN', signedInstallation: 'NOT_RUN', physicalAudio: 'NOT_RUN' },
  };
  try {
    assert(Buffer.isBuffer(bytes) && bytes.length <= 2 * 1024 * 1024);
    const report = JSON.parse(bytes), plan = report.plan;
    assert.equal(report.schemaVersion, 1); assert.equal(report.kind, 'verification-shadow-plan');
    assert.equal(report.source.head, identity.merge); assert.equal(report.source.dirty, false);
    assert.equal(report.stable, true); assert.deepEqual(report.source, report.sourceAfter);
    assert.match(report.source.inputHash, /^[a-f0-9]{64}$/);
    assert.equal(report.catalogSha256, pins.catalogSha256);
    assert.equal(digest(JSON.stringify({ catalog: report.catalog, releaseGates: report.releaseGates })), pins.catalogSha256);
    assert.deepEqual(report.catalog.map(task => task.id), [...TASKS, ...EXTRA_TASKS]);
    assert.deepEqual(report.releaseGates.map(gate => gate.id), RELEASE_GATES);
    assert(report.releaseGates.every(gate => gate.automatic === false));
    assert.deepEqual(plan.identity, identity); assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.policy, POLICY); assert.equal(plan.shadowOnly, true); assert.equal(plan.profile, 'full');
    assert(['complete','missing','invalid'].includes(plan.changeMetadata));
    assert(report.rawChanges === null || (typeof report.rawChanges === 'string' && Buffer.byteLength(report.rawChanges) <= 1024 * 1024));
    assert.equal(plan.changesSha256, digest(report.rawChanges ?? 'missing'));
    if (report.rawChanges === null) assert.equal(plan.changeMetadata, 'missing');
    else assert.notEqual(plan.changeMetadata, 'missing');
    assert([['reader'],['hear'],['reader','hear']].some(allowed => isDeepStrictEqual(plan.products,allowed)));
    if (plan.changeMetadata !== 'complete') assert.deepEqual(plan.products, ['reader','hear']);
    assert.deepEqual(plan.enforcedReaderTasks, TASKS); assert.deepEqual(plan.releaseGates, report.releaseGates);
    // Derive task membership, topological order and dependency closure from the
    // independently pinned catalog. Path selection stays in the private planner.
    const byId = new Map(report.catalog.map(task => [task.id, task])), ordered = [], visited = new Set(), active = new Set();
    const visit = id => {
      assert(byId.has(id) && !active.has(id)); if (visited.has(id)) return;
      active.add(id); const task = byId.get(id); task.dependencies.forEach(visit);
      active.delete(id); visited.add(id); ordered.push(task);
    };
    for (const task of report.catalog) if ((task.profile === 'quick' && task.products.includes('reader')) || task.products.some(product => plan.products.includes(product))) visit(task.id);
    assert.deepEqual(plan.tasks, ordered.map(task => ({ ...task, status: 'NOT_RUN' })));
    const entries = plan.tasks.map(({ status, ...task }) => { assert.equal(status, 'NOT_RUN'); return task; });
    assert.equal(plan.planSha256, digest(JSON.stringify({ policy: POLICY, identity, profile: 'full', changeMetadata: plan.changeMetadata, products: plan.products, entries, releaseGates: report.releaseGates })));
    Object.assign(result, { validation: 'PASS', summarySha256: digest(bytes), planSha256: plan.planSha256, changesSha256: plan.changesSha256, changeMetadata: plan.changeMetadata, products: plan.products, plannedTasks: entries.map(({ id }) => ({ id, status: 'NOT_RUN' })) });
    if (outcome('controls') === 'success') result.controls = CONTROL_CLASSES.map(id => ({ id, kind: 'generated-git-control', status: 'PASS' }));
    if (outcome('controls') === 'success' && outcome('plan') === 'success') result.status = 'PASS';
  } catch { /* Invalid or unbound plans supply no successful qualification. */ }
  return result;
}
function ordinary(file, limit) {
  const info = lstatSync(file); assert(info.isFile() && !info.isSymbolicLink() && info.size <= limit);
  return readFileSync(file);
}
export function verifyImplementation(source, expected = PINS.implementation) {
  for (const [file, hash] of Object.entries(expected)) assert.equal(digest(ordinary(join(source, file), 2 * 1024 * 1024)), hash);
}
function privateBytes(source) {
  for (const folder of [join(source,'.artifacts'),join(source,'.artifacts/verification-plan')]) {
    const info = lstatSync(folder); assert(info.isDirectory() && !info.isSymbolicLink());
  }
  return ordinary(join(source,'.artifacts/verification-plan/plan.json'), 2 * 1024 * 1024);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3); const mode = process.argv[2]; assert(['identity','collect','require'].includes(mode));
    const value = binding(JSON.parse(process.env.VERIFICATION_BINDING)), run = positive(process.env.GITHUB_RUN_ID), attempt = positive(process.env.GITHUB_RUN_ATTEMPT);
    assert.equal(process.env.GITHUB_REPOSITORY, 'lwtlab/reader'); assert.equal(process.env.GITHUB_SHA, value.workflow);
    const source = resolve('source'), output = resolve('shadow-plan-output');
    if (mode === 'identity') {
      verifyImplementation(source);
      const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) }).trim();
      assert.equal(git(['rev-parse','HEAD']), value.tested); assert.equal(git(['status','--porcelain']), '');
      appendFileSync(process.env.GITHUB_ENV, `VERIFICATION_PLAN_IDENTITY=${JSON.stringify(planIdentity(value,run,attempt))}\n`);
      console.log('Reviewed planner pins and immutable tested checkout verified');
    } else {
      const outcomes = { controls: process.env.SHADOW_CONTROLS_OUTCOME, plan: process.env.SHADOW_PLAN_OUTCOME };
      let bytes; try { verifyImplementation(source); bytes = privateBytes(source); } catch { bytes = null; }
      const result = planResult(bytes, value, run, attempt, outcomes);
      if (mode === 'collect') {
        assert(!existsSync(output)); mkdirSync(output, { mode: 0o700 });
        const key = readFileSync(new URL('./build-logs-public.pem', import.meta.url));
        if (bytes) writeFileSync(join(output,'plan.enc.json'), JSON.stringify(encryptLog(bytes,key)), { mode: 0o600 });
        const log = join(process.env.RUNNER_TEMP,'reader-private-build.log');
        if (existsSync(log)) writeFileSync(join(output,'controls-log.enc.json'), JSON.stringify(encryptLog(ordinary(log,8*1024*1024),key)), { mode: 0o600 });
        writeFileSync(join(output,'verification.json'), JSON.stringify(result,null,2), { mode: 0o600 });
        console.log(`Shadow qualification: ${result.status}; product gates remain NOT_RUN`);
      } else {
        assert.deepEqual(JSON.parse(ordinary(join(output,'verification.json'),65536)),result); assert.equal(result.status,'PASS');
      }
    }
  } catch { console.error('Shadow plan qualification failed; inspect authenticated encrypted diagnostics'); process.exitCode = 1; }
}
