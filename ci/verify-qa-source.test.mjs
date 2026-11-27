import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  allowedQaChangedPath, allowedQaChangedPaths, linkQaDependencies, recordQaSource, runHostContracts, runVolumeQa, verifyQaSource, volumeQaEntries,
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
function fixture(t, { gitlink = false, inheritedAutoCrlf = false, volumeBody } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reader-independent-qa-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'application source 中文');
  const qaSource = path.join(directory, 'QA source 中文');
  initialize(source);
  put(source, '.gitignore', '**/node_modules\napps/reader/release\n');
  put(source, allowedQaChangedPath, 'Original authored synthetic host test\n');
  put(source, allowedQaChangedPaths[1], "export const fixtureVolume = 'original';\n");
  put(source, allowedQaChangedPaths[2], `import { writeFileSync } from 'node:fs'; import path from 'node:path'; import test from 'node:test'; writeFileSync(path.join(process.cwd(),'volume-contract-call.json'),JSON.stringify({cwd:process.cwd(),entry:process.argv[1],args:process.argv.slice(2)})); test('original synthetic volume contract',()=>{});\n`);
  for (const name of volumeQaEntries) put(source, `apps/reader/scripts/${name}`, volumeBody || `import { fixtureVolume } from './desktop-storage-volume.mjs'; import { writeFileSync } from 'node:fs'; import path from 'node:path'; writeFileSync(path.join(process.cwd(),'volume-call.json'),JSON.stringify({cwd:process.cwd(),entry:process.argv[1],args:process.argv.slice(2),fixtureVolume}));\n`);
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
    assert.throws(() => verifyQaSource(f.options), /outside the fixed reviewed QA allowance/);
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
  assert.throws(() => verifyQaSource(f.options), /outside the fixed reviewed QA allowance/);
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

function candidate(f, root = f.source) {
  const target = `${process.platform}-${process.arch}`;
  const directory = path.join(root, 'apps/reader/release/core', target);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'desktop-artifacts.json'), JSON.stringify({schemaVersion:1,version:'0.26.1',platform:process.platform,arch:process.arch,profile:'core',artifacts:[]}));
  return directory;
}

for (const filename of allowedQaChangedPaths.slice(1)) {
  test(`allows only the existing reviewed owned-volume QA blob: ${filename}`, (t) => {
    const f = fixture(t);
    const original = readFileSync(path.join(f.source, filename));
    put(f.qaSource, filename, 'Reviewed authored synthetic volume QA correction\n');
    f.options.qaRef = commit(f.qaSource);
    assert.deepEqual(verifyQaSource(f.options).changedPaths, [filename]);
    assert.deepEqual(readFileSync(path.join(f.source, filename)), original);
  });
}

test('the fixed allowance cannot authorize new QA files or mode changes', (t) => {
  assert.equal(Object.isFrozen(allowedQaChangedPaths), true);
  assert.equal(allowedQaChangedPaths.length, 3);
  const f = fixture(t);
  git(f.qaSource, 'update-index', '--chmod=+x', allowedQaChangedPaths[1]);
  git(f.qaSource, 'commit', '-qm', 'Original synthetic mode-only QA mutation');
  f.options.qaRef = git(f.qaSource, 'rev-parse', 'HEAD');
  assert.throws(() => verifyQaSource(f.options), /mode|tracked modifications/);
});

function cleanupContractCommand(f, independent = true) {
  const helper = fileURLToPath(new URL('./verify-qa-source.mjs', import.meta.url));
  const args = [helper,'run-volume-contracts','--source',f.source,'--source-ref',f.sourceRef];
  if(independent) args.push('--qa-source',f.qaSource,'--qa-ref',f.options.qaRef);
  // Invoke the real standalone CLI as Actions does, outside the parent test
  // runner's internal recursion context; otherwise Node intentionally skips it.
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  execFileSync(process.execPath,args,{cwd:f.directory,env,stdio:['ignore','pipe','pipe']});
}

test('runs only the fixed cleanup Node regression from QA with application cwd', (t) => {
  const f = fixture(t);
  f.correctTest();
  f.dependencies();
  linkQaDependencies(f.options);
  cleanupContractCommand(f);
  const call = JSON.parse(readFileSync(path.join(f.source, 'apps/reader/volume-contract-call.json'), 'utf8'));
  assert.equal(call.cwd, realpathSync.native(path.join(f.source, 'apps/reader')));
  assert.equal(call.entry, realpathSync.native(path.join(f.qaSource, allowedQaChangedPaths[2])));
  assert.deepEqual(call.args, []);
});

for (const entry of volumeQaEntries) {
  test(`runs fixed packaged QA ${entry} against the actual application candidate`, (t) => {
    const f = fixture(t);
    f.correctTest();
    f.dependencies();
    linkQaDependencies(f.options);
    const directory = candidate(f);
    runVolumeQa(f.options, entry, directory);
    const call = JSON.parse(readFileSync(path.join(f.source, 'apps/reader/volume-call.json'), 'utf8'));
    assert.equal(call.cwd, realpathSync.native(path.join(f.source, 'apps/reader')));
    assert.equal(call.entry, realpathSync.native(path.join(f.qaSource, `apps/reader/scripts/${entry}`)));
    assert.deepEqual(call.args, [realpathSync.native(directory)]);
  });
}

test('fixed packaged QA loads the reviewed QA cleanup module while retaining application binaries', (t) => {
  const f=fixture(t);
  put(f.qaSource,allowedQaChangedPaths[1],"export const fixtureVolume = 'reviewed-correction';\n");
  f.options.qaRef=commit(f.qaSource);
  f.dependencies();linkQaDependencies(f.options);
  runVolumeQa(f.options,volumeQaEntries[0],candidate(f));
  const call=JSON.parse(readFileSync(path.join(f.source,'apps/reader/volume-call.json')));
  assert.equal(call.fixtureVolume,'reviewed-correction');
  assert.equal(readFileSync(path.join(f.source,allowedQaChangedPaths[1]),'utf8'),"export const fixtureVolume = 'original';\n");
});

test('packaged volume QA rejects arbitrary entries and QA-owned, external or relative candidates', (t) => {
  const f = fixture(t);
  f.correctTest(); f.dependencies(); linkQaDependencies(f.options);
  const directory = candidate(f);
  for (const entry of ['smoke-desktop-window.mjs','../smoke-desktop-storage.mjs',path.join(f.qaSource,'apps/reader/scripts/smoke-desktop-storage.mjs')])
    assert.throws(() => runVolumeQa(f.options, entry, directory), /Only fixed/);
  assert.throws(() => runVolumeQa(f.options, volumeQaEntries[0], candidate(f, f.qaSource)), /application-owned/);
  assert.throws(() => runVolumeQa(f.options, volumeQaEntries[0], candidate(f, path.join(f.directory,'external'))), /application-owned/);
  assert.throws(() => runVolumeQa(f.options, volumeQaEntries[0], 'release/core/target'), /absolute application/);
  assert.equal(existsSync(path.join(f.source,'apps/reader/volume-call.json')),false);
});

for (const field of ['schemaVersion','version','platform','arch','profile','target']) {
  test(`packaged volume QA rejects a mismatched artifact ${field}`, (t) => {
    const f = fixture(t); f.dependencies();
    const directory = candidate(f);
    const indexFile = path.join(directory,'desktop-artifacts.json');
    const index = JSON.parse(readFileSync(indexFile));
    if(field === 'target') {
      const changed = path.join(path.dirname(directory),'wrong-target');
      mkdirSync(changed); writeFileSync(path.join(changed,'desktop-artifacts.json'),JSON.stringify(index));
      assert.throws(() => runVolumeQa({source:f.source,sourceRef:f.sourceRef},volumeQaEntries[0],changed),/target differs/);
    } else {
      index[field] = field === 'schemaVersion' ? 99 : 'not-the-original';
      writeFileSync(indexFile,JSON.stringify(index));
      assert.throws(() => runVolumeQa({source:f.source,sourceRef:f.sourceRef},volumeQaEntries[0],directory));
    }
    assert.equal(existsSync(path.join(f.source,'apps/reader/volume-call.json')),false);
  });
}

test('default-source volume QA needs no second checkout or dependency install', (t) => {
  const f = fixture(t); f.dependencies();
  const options={source:f.source,sourceRef:f.sourceRef};
  cleanupContractCommand(f,false);
  assert.equal(existsSync(path.join(f.source,'apps/reader/volume-contract-call.json')),true);
  runVolumeQa(options,volumeQaEntries[0],candidate(f));
  const call=JSON.parse(readFileSync(path.join(f.source,'apps/reader/volume-call.json')));
  assert.equal(call.entry,realpathSync.native(path.join(f.source,`apps/reader/scripts/${volumeQaEntries[0]}`)));
  assert.equal(existsSync(path.join(f.qaSource,'apps/reader/node_modules')),false);
});

test('packaged volume QA retains child failure and rejects post-test source mutation', (t) => {
  const failed=fixture(t,{volumeBody:"throw new Error('Original synthetic volume QA failure');\n"});
  failed.dependencies();
  assert.throws(() => runVolumeQa({source:failed.source,sourceRef:failed.sourceRef},volumeQaEntries[0],candidate(failed)),(error)=>Number.isInteger(error.status)&&error.status>0);
  assert.deepEqual(verifyQaSource({source:failed.source,sourceRef:failed.sourceRef}).changedPaths,[]);
  const changed=fixture(t,{volumeBody:"import { writeFileSync } from 'node:fs'; writeFileSync('electron/main/runtime.ts','Original synthetic forbidden mutation');\n"});
  changed.dependencies();
  assert.throws(() => runVolumeQa({source:changed.source,sourceRef:changed.sourceRef},volumeQaEntries[0],candidate(changed)),/tracked modifications/);
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
  assert.deepEqual(receipt, { schemaVersion: 1, applicationSourceSha: f.sourceRef, qaSourceSha: f.options.qaRef, allowedChangedPaths: [...allowedQaChangedPaths], changedPaths: [allowedQaChangedPath], allowedChangedPath: allowedQaChangedPath, allowedTestDiffers: true });
  const text = readFileSync(output, 'utf8');
  assert.ok(!text.includes(f.source) && !text.includes(f.qaSource) && !text.includes('synthetic runtime'));
  assert.throws(() => recordQaSource(f.options, output), /EEXIST/);
  assert.throws(() => recordQaSource(f.options, path.join(f.directory, 'desktop-qa-source.json')), /inside the application candidate/);
});

test('volume-only QA provenance records the complete fixed allowance and actual changed paths', (t) => {
  const f=fixture(t);
  put(f.qaSource,allowedQaChangedPaths[1],"export const fixtureVolume = 'reviewed-correction';\n");
  f.options.qaRef=commit(f.qaSource);f.dependencies();linkQaDependencies(f.options);
  const receipt=recordQaSource(f.options,path.join(candidate(f),'desktop-qa-source.json'));
  assert.deepEqual(receipt.allowedChangedPaths,[...allowedQaChangedPaths]);
  assert.deepEqual(receipt.changedPaths,[allowedQaChangedPaths[1]]);
  assert.equal(receipt.allowedTestDiffers,false);
});

test('public workflow preserves every host filter and confines separate QA to fixed host and volume contracts', () => {
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
  assert.ok(workflow.indexOf('Test reviewed owned-volume cleanup contracts') < workflow.indexOf('Build unsigned candidates without publishing'));
  assert.match(workflow, /Test reviewed owned-volume cleanup contracts\n\s+if: inputs\.qa_source_ref != ''[\s\S]*?run-volume-contracts/);
  assert.equal((workflow.match(/run-volume-qa/g)||[]).length,4);
  for(const entry of volumeQaEntries) assert.equal((workflow.match(new RegExp(`--entry ${entry.replaceAll('.','\\.')}`,'g'))||[]).length,2);
  assert.equal((workflow.match(/--candidate (?:"\$GITHUB_WORKSPACE\/source\/apps\/reader\/release\/core\/|\$candidate)/g)||[]).length,4);
  assert.ok(workflow.includes("scripts/desktop-installer-target.test.mjs scripts/desktop-profile-storage-probe.test.mjs"), 'The original application Node contracts must stay unchanged');

});
