import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  allowedQaChangedPath, linkQaDependencies, recordQaSource, runHostContracts, verifyQaSource,
} from './verify-qa-source.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function put(root, file, content) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}
function initialize(root) {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Synthetic QA fixture');
  git(root, 'config', 'user.email', 'qa@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'core.hooksPath', path.join(root, '.git', 'unused-fixture-hooks'));
}
function commit(root, message = 'Authored synthetic fixture') {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}
function fixture(t, { gitlink = false, inheritedAutoCrlf = false } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reader-independent-qa-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'application source 中文');
  const qaSource = path.join(directory, 'QA source 中文');
  initialize(source);
  put(source, '.gitignore', '**/node_modules\napps/reader/release\n');
  put(source, allowedQaChangedPath, 'Original authored synthetic host test\n');
  put(source, 'apps/reader/electron/main/runtime.ts', 'Authored synthetic runtime must stay unchanged\n');
  put(source, 'apps/reader/package.json', '{"name":"synthetic-reader-fixture","version":"0.26.1"}\n');
  put(source, 'apps/reader/pnpm-lock.yaml', 'lockfileVersion: synthetic-fixture\n');
  put(source, 'apps/reader/notices/NOTICE.txt', 'Original authored synthetic notice\n');
  put(source, 'CONTEXT.md', 'Authored synthetic domain context\n');
  if (gitlink) {
    const nested = path.join(source, 'aspeak');
    initialize(nested);
    put(nested, 'fixture.txt', 'Authored synthetic submodule\n');
    commit(nested);
    git(source, 'add', 'aspeak');
  }
  const sourceRef = commit(source);
  // Configure before clone's initial checkout; setting this afterward leaves
  // Windows' globally converted CRLF bytes dirty against the reviewed index.
  const cloneArgs = ['clone', '-q', '--no-hardlinks', '--config', 'core.autocrlf=false', source, qaSource];
  if (inheritedAutoCrlf) {
    const config = path.join(directory, 'synthetic-global.gitconfig');
    writeFileSync(config, '[core]\n\tautocrlf = true\n');
    execFileSync('git', ['-C', directory, ...cloneArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' },
    });
  } else git(directory, ...cloneArgs);
  git(qaSource, 'config', 'user.name', 'Synthetic QA fixture');
  git(qaSource, 'config', 'user.email', 'qa@example.invalid');
  git(qaSource, 'config', 'commit.gpgsign', 'false');
  git(qaSource, 'config', 'core.autocrlf', 'false');
  git(qaSource, 'config', 'core.hooksPath', path.join(qaSource, '.git', 'unused-fixture-hooks'));
  const options = { source, sourceRef, qaSource, qaRef: sourceRef };
  return {
    directory, source, qaSource, sourceRef, options,
    correctTest() {
      put(qaSource, allowedQaChangedPath, 'Corrected authored synthetic host test\n');
      options.qaRef = commit(qaSource, 'Correct only the reviewed host test');
      return options;
    },
    dependencies(body = '') {
      const entry = path.join(source, 'apps/reader/node_modules/vitest/vitest.mjs');
      mkdirSync(path.dirname(entry), { recursive: true });
      writeFileSync(entry, body || 'process.exitCode = 0;\n');
      return entry;
    },
  };
}

test('default source needs no second checkout and never changes application identity', (t) => {
  const f = fixture(t);
  const selected = verifyQaSource({ source: f.source, sourceRef: f.sourceRef });
  assert.equal(selected.application.root, selected.qa.root);
  assert.equal(selected.qa.head, f.sourceRef);
  assert.deepEqual(selected.changedPaths, []);
  f.dependencies();
  assert.equal(linkQaDependencies({ source: f.source, sourceRef: f.sourceRef }).qa.head, f.sourceRef);
});

test('temporary-directory and native aliases select the same physical checkout root', (t) => {
  const f = fixture(t);
  const nativeRoot = realpathSync.native(f.source);
  const fromTemporaryPath = verifyQaSource({ source: f.source, sourceRef: f.sourceRef });
  const fromNativePath = verifyQaSource({ source: nativeRoot, sourceRef: f.sourceRef });
  assert.equal(fromTemporaryPath.application.root, nativeRoot);
  assert.equal(fromNativePath.application.root, nativeRoot);
  assert.deepEqual(fromTemporaryPath.changedPaths, []);
  assert.throws(() => verifyQaSource({ source: path.join(nativeRoot, 'apps/reader'), sourceRef: f.sourceRef }), /checkout root/);
});

test('fixture clone keeps reviewed blobs unchanged under inherited autocrlf', (t) => {
  const f = fixture(t, { inheritedAutoCrlf: true });
  assert.deepEqual(verifyQaSource(f.options).changedPaths, []);
  f.correctTest();
  assert.deepEqual(verifyQaSource(f.options).changedPaths, [allowedQaChangedPath]);
  assert.equal(git(f.qaSource, 'config', '--get', 'core.autocrlf'), 'false');
});

test('allows only the reviewed test blob while retaining the original compiled source SHA', (t) => {
  const f = fixture(t);
  f.correctTest();
  const selected = verifyQaSource(f.options);
  assert.equal(selected.application.head, f.sourceRef);
  assert.notEqual(selected.qa.head, f.sourceRef);
  assert.deepEqual(selected.changedPaths, [allowedQaChangedPath]);
  assert.equal(readFileSync(path.join(f.source, allowedQaChangedPath), 'utf8'), 'Original authored synthetic host test\n');
});

for (const file of ['apps/reader/electron/main/runtime.ts', 'apps/reader/package.json', 'apps/reader/pnpm-lock.yaml', 'apps/reader/notices/NOTICE.txt', 'CONTEXT.md']) {
  test(`rejects a changed compiled/dependency/notice input: ${file}`, (t) => {
    const f = fixture(t);
    f.correctTest();
    put(f.qaSource, file, 'Substituted authored synthetic content\n');
    f.options.qaRef = commit(f.qaSource);
    assert.throws(() => verifyQaSource(f.options), /outside the one reviewed host test/);
  });
}

test('rejects added and removed tracked paths even when the host test is allowed', (t) => {
  const added = fixture(t);
  put(added.qaSource, 'apps/reader/electron/main/additional.ts', 'Authored synthetic addition\n');
  added.options.qaRef = commit(added.qaSource);
  assert.throws(() => verifyQaSource(added.options), /add or remove/);
  const removed = fixture(t);
  rmSync(path.join(removed.qaSource, allowedQaChangedPath));
  removed.options.qaRef = commit(removed.qaSource);
  assert.throws(() => verifyQaSource(removed.options), /add or remove/);
});

test('rejects mode-only changes, including mode changes to the allowed test', (t) => {
  const f = fixture(t);
  chmodSync(path.join(f.qaSource, allowedQaChangedPath), 0o755);
  git(f.qaSource, 'update-index', '--chmod=+x', allowedQaChangedPath);
  git(f.qaSource, 'commit', '-qm', 'Authored synthetic mode-only change');
  f.options.qaRef = git(f.qaSource, 'rev-parse', 'HEAD');
  assert.throws(() => verifyQaSource(f.options), /mode|tracked modifications/);
});

test('rejects a changed Gitlink commit without requiring recursive submodule initialization', (t) => {
  const f = fixture(t, { gitlink: true });
  git(f.qaSource, 'update-index', '--cacheinfo', `160000,${'a'.repeat(40)},aspeak`);
  git(f.qaSource, 'commit', '-qm', 'Authored synthetic Gitlink change');
  f.options.qaRef = git(f.qaSource, 'rev-parse', 'HEAD');
  assert.throws(() => verifyQaSource(f.options), /outside the one reviewed host test/);
});

test('rejects missing/mismatched HEADs and undeclared independent checkouts', (t) => {
  const f = fixture(t);
  assert.throws(() => verifyQaSource({ ...f.options, sourceRef: undefined }), /immutable checkout SHA/);
  assert.throws(() => verifyQaSource({ ...f.options, sourceRef: 'f'.repeat(40) }), /HEAD differs/);
  assert.throws(() => verifyQaSource({ ...f.options, qaRef: 'f'.repeat(40) }), /HEAD differs/);
  assert.throws(() => verifyQaSource({ ...f.options, qaRef: undefined }), /explicit immutable QA SHA/);
  assert.throws(() => verifyQaSource({ source: f.source, sourceRef: f.sourceRef, qaRef: 'f'.repeat(40) }), /own checkout/);
  assert.throws(() => verifyQaSource({ source: path.join(f.source, 'apps/reader'), sourceRef: f.sourceRef }), /checkout root/);
});

test('rejects dirty tracked source, staged source and dirty QA without exposing their contents', (t) => {
  const f = fixture(t);
  put(f.source, 'apps/reader/electron/main/runtime.ts', 'Uncommitted authored synthetic runtime\n');
  assert.throws(() => verifyQaSource(f.options), /tracked modifications/);
  git(f.source, 'add', '-A');
  assert.throws(() => verifyQaSource(f.options), /tracked modifications/);
  git(f.source, 'reset', '--hard', f.sourceRef);
  put(f.qaSource, allowedQaChangedPath, 'Uncommitted authored synthetic test\n');
  assert.throws(() => verifyQaSource(f.options), /tracked modifications/);
});

test('links only independent QA dependencies to the actual application modules', (t) => {
  const f = fixture(t);
  f.correctTest();
  f.dependencies();
  linkQaDependencies(f.options);
  assert.equal(readFileSync(path.join(f.qaSource, 'apps/reader/node_modules/vitest/vitest.mjs'), 'utf8'), 'process.exitCode = 0;\n');
  assert.throws(() => linkQaDependencies(f.options), /existing QA node_modules/);
});

for (const kind of ['directory', 'file', 'matching-link', 'unrelated-link', 'dangling-link']) {
  test(`rejects an already existing QA dependency path: ${kind}`, (t) => {
    const f = fixture(t);
    f.dependencies();
    const qaModules = path.join(f.qaSource, 'apps/reader/node_modules');
    if (kind === 'directory') mkdirSync(qaModules);
    else if (kind === 'file') writeFileSync(qaModules, 'Authored synthetic obstruction\n');
    else {
      const target = kind === 'matching-link' ? path.join(f.source, 'apps/reader/node_modules')
        : path.join(f.directory, kind === 'dangling-link' ? 'missing-modules' : 'unrelated-modules');
      if (kind === 'unrelated-link') mkdirSync(target);
      symlinkSync(target, qaModules, process.platform === 'win32' ? 'junction' : 'dir');
    }
    assert.throws(() => linkQaDependencies(f.options), /existing QA node_modules/);
  });
}

test('runs the fixed actual application entry in QA cwd with the original worker/filter arguments', (t) => {
  const f = fixture(t);
  f.correctTest();
  const marker = path.join(f.directory, 'host-contract-call.json');
  const entry = f.dependencies(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, JSON.stringify({cwd:process.cwd(),entry:process.argv[1],args:process.argv.slice(2)}));\n`);
  linkQaDependencies(f.options);
  const args = ['--maxWorkers=2', 'electron/main', 'lib/desktop', 'app/api/articles/[slug]/route.test.ts'];
  runHostContracts(f.options, entry, args);
  const call = JSON.parse(readFileSync(marker, 'utf8'));
  assert.equal(call.cwd, realpathSync.native(path.join(f.qaSource, 'apps/reader')));
  assert.equal(call.entry, realpathSync.native(entry));
  assert.deepEqual(call.args, ['run', ...args]);
  assert.throws(() => runHostContracts(f.options, path.join(f.directory, 'arbitrary-runner.mjs'), []), /Only the selected application Vitest entry/);
});

test('the unchanged default executes application cwd without creating a QA dependency link', (t) => {
  const f = fixture(t);
  const marker = path.join(f.directory, 'default-host-contract-call.json');
  const entry = f.dependencies(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, process.cwd());\n`);
  runHostContracts({ source: f.source, sourceRef: f.sourceRef }, entry, ['electron/main']);
  assert.equal(readFileSync(marker, 'utf8'), realpathSync.native(path.join(f.source, 'apps/reader')));
  assert.equal(existsSync(path.join(f.qaSource, 'apps/reader/node_modules')), false);
});

test('real private-step wrapper retains its cwd allowlist and encrypted-log boundary with QA cwd inside the helper', (t) => {
  const f = fixture(t);
  f.correctTest();
  const marker = path.join(f.directory, 'wrapped-host-call.json');
  const entry = f.dependencies(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));\n`);
  linkQaDependencies(f.options);
  symlinkSync(f.source, path.join(f.directory, 'source'), process.platform === 'win32' ? 'junction' : 'dir');
  const wrapper = fileURLToPath(new URL('./private-step.mjs', import.meta.url));
  const helper = fileURLToPath(new URL('./verify-qa-source.mjs', import.meta.url));
  const stdout = execFileSync(process.execPath, [wrapper, 'host-contracts', 'source/apps/reader', process.execPath, helper, 'run-host-contracts', '--source', f.source, '--source-ref', f.sourceRef, '--qa-source', f.qaSource, '--qa-ref', f.options.qaRef, '--vitest', entry, '--', '--maxWorkers=1', 'electron/main'], { cwd: f.directory, env: { ...process.env, RUNNER_TEMP: f.directory }, encoding: 'utf8' });
  assert.match(stdout, /host-contracts passed/);
  const call = JSON.parse(readFileSync(marker, 'utf8'));
  assert.equal(call.cwd, realpathSync.native(path.join(f.qaSource, 'apps/reader')));
  assert.deepEqual(call.args, ['run', '--maxWorkers=1', 'electron/main']);
  const log = readFileSync(path.join(f.directory, 'reader-private-build.log'), 'utf8');
  assert.match(log, /Verified immutable application and limited host-test source/);
  assert.ok(!stdout.includes(f.source) && !stdout.includes(f.qaSource));
});

test('detects a host test modifying tracked application source after execution', (t) => {
  const f = fixture(t);
  f.correctTest();
  const runtime = path.join(f.source, 'apps/reader/electron/main/runtime.ts');
  const entry = f.dependencies(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(runtime)}, 'Authored synthetic post-test mutation\\n');\n`);
  linkQaDependencies(f.options);
  assert.throws(() => runHostContracts(f.options, entry, ['electron/main']), /tracked modifications/);
});

test('records only separate SHAs and the fixed allowed path after candidate finalization', (t) => {
  const f = fixture(t);
  f.correctTest();
  f.dependencies();
  linkQaDependencies(f.options);
  const output = path.join(f.source, 'apps/reader/release/core/win32-x64/desktop-qa-source.json');
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(path.join(path.dirname(output), 'desktop-artifacts.json'), JSON.stringify({ platform: 'win32', arch: 'x64' }));
  const receipt = recordQaSource(f.options, output);
  assert.deepEqual(receipt, { schemaVersion: 1, applicationSourceSha: f.sourceRef, qaSourceSha: f.options.qaRef, allowedChangedPath: allowedQaChangedPath, allowedTestDiffers: true });
  const text = readFileSync(output, 'utf8');
  assert.ok(!text.includes(f.source) && !text.includes(f.qaSource) && !text.includes('synthetic runtime'));
  assert.throws(() => recordQaSource(f.options, output), /EEXIST/);
  assert.throws(() => recordQaSource(f.options, path.join(f.directory, 'desktop-qa-source.json')), /inside the application candidate/);
});

test('public workflow preserves every host filter and confines separate QA to host contracts', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8');
  assert.match(workflow, /qa_source_ref:[\s\S]*?required: false/);
  assert.match(workflow, /path: qa-source[\s\S]*?persist-credentials: false[\s\S]*?submodules: false/);
  assert.match(workflow, /host-contracts source\/apps\/reader node \.\.\/\.\.\/\.\.\/ci\/verify-qa-source\.mjs run-host-contracts/);
  assert.ok(workflow.includes('--vitest "$GITHUB_WORKSPACE/source/apps/reader/node_modules/vitest/vitest.mjs"'));
  for (const filter of ['scripts/reader-module-preloads.test.ts', 'scripts/electron-sqlite.test.ts', 'electron/main lib/desktop app/api/health/route.test.ts', 'lib/transcribe/asr-readiness.test.ts', 'lib/transcribe/availability.test.ts', 'lib/transcribe/paths.test.ts', 'lib/transcribe/sync.test.ts', 'lib/transcribe/qwen3/manager.test.ts', 'app/api/transcribe/route.test.ts', 'app/api/transcribe/sync/route.test.ts', 'app/api/transcribe/retry/route.test.ts', 'app/api/narration/route.test.ts', 'lib/config/store.test.ts', 'lib/config/store-atomic.test.ts', 'lib/config/store-read-errors.test.ts', 'lib/config/store-corruption.test.ts', 'lib/db/client-retry.test.ts', 'lib/application/sync-push/review-local.real-db.test.ts', 'lib/lang/current.test.ts', 'lib/lang/context.test.ts', 'components/add-content/AddContentDialog.test.tsx', 'embed/app/routes/profile-route.test.tsx', 'lib/articles/part-store-read-errors.test.ts', 'lib/articles/part-store-corruption.test.ts', 'lib/articles/part-store-durable.test.ts', 'scripts/desktop-storage-probe.test.ts', 'lib/articles/part-store.test.ts', 'lib/books/list.test.ts', 'app/api/articles/[slug]/route.test.ts', 'app/api/articles/[slug]/parts/[partId]/route.test.ts']) assert.ok(workflow.includes(filter), `Missing original host-contract filter: ${filter}`);
  assert.ok(workflow.includes("--maxWorkers=${{ matrix.id == 'darwin-x64' && 1 || 2 }}"));
  assert.ok(workflow.indexOf('Confirm host tests left both tracked source trees unchanged') < workflow.indexOf('Build unsigned candidates without publishing'));
  assert.ok(workflow.indexOf('Record immutable application and independent host-test provenance') < workflow.indexOf('Audit final candidate files before upload'));
  assert.ok(workflow.includes('/desktop-*.json'));
  assert.match(workflow, /READER_BUILD_SHA: \$\{\{ inputs.source_ref \}\}/);
});
