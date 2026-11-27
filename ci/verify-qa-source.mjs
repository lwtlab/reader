import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Reviewed host-test and owned-volume QA corrections cannot change compiled inputs.
export const allowedQaChangedPaths = Object.freeze([
  'apps/reader/electron/main/appimage-install.test.ts',
  'apps/reader/scripts/desktop-storage-volume.mjs',
  'apps/reader/scripts/desktop-profile-storage-probe.test.mjs',
]);
// Compatibility for consumers of the original host-test-only receipt.
export const allowedQaChangedPath = allowedQaChangedPaths[0];
export const volumeQaEntries = Object.freeze(['smoke-desktop-storage.mjs', 'smoke-desktop-profile-storage.mjs']);
const revision = /^[a-f0-9]{40}$/;
// Git for Windows expands 8.3 temporary-directory aliases. Use the native
// filesystem result on both sides, including junction and Reader path checks.
const samePath = (left, right) => process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right);

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Unable to verify the immutable private checkout');
  }
}

function checkout(root, expected) {
  assert.match(expected ?? '', revision, 'A full immutable checkout SHA is required');
  const actualRoot = realpathSync.native(path.resolve(root));
  assert.ok(samePath(realpathSync.native(git(actualRoot, ['rev-parse', '--show-toplevel']).trim()), actualRoot), 'The selected directory must be the checkout root');
  const head = git(actualRoot, ['rev-parse', '--verify', 'HEAD']).trim();
  assert.equal(head, expected, 'Checkout HEAD differs from its declared immutable source');
  assert.equal(
    git(actualRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=no', '--ignore-submodules=untracked']),
    '', 'Private checkout has tracked modifications',
  );
  const files = new Map();
  for (const row of git(actualRoot, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
    const match = row.match(/^([0-7]{6}) ([a-f0-9]{40}) ([0-3])\t([\s\S]+)$/);
    assert.ok(match && match[3] === '0', 'Checkout index must contain only resolved tracked entries');
    assert.equal(files.has(match[4]), false, 'Duplicate tracked index entry');
    files.set(match[4], { mode: match[1], blob: match[2] });
  }
  assert.ok(files.size, 'An empty private checkout cannot qualify a candidate');
  return { root: actualRoot, head, files };
}

/** Compare complete index maps; even Gitlink, mode and notice changes are rejected. */
export function verifyQaSource({ source, sourceRef, qaSource, qaRef } = {}) {
  const application = checkout(source, sourceRef);
  const selectedRef = qaRef || sourceRef;
  assert.ok(!qaSource || qaRef, 'An independent QA checkout needs an explicit immutable QA SHA');
  assert.ok(qaSource || selectedRef === sourceRef, 'A different QA revision needs its own checkout');
  const qa = qaSource ? checkout(qaSource, selectedRef) : application;
  const changedPaths = [];
  for (const filename of new Set([...application.files.keys(), ...qa.files.keys()])) {
    const before = application.files.get(filename), after = qa.files.get(filename);
    assert.ok(before && after, 'QA may not add or remove tracked application inputs');
    assert.equal(after.mode, before.mode, 'QA may not change any tracked file mode or Gitlink mode');
    if (before.blob !== after.blob) {
      assert.ok(allowedQaChangedPaths.includes(filename), 'QA differs outside the fixed reviewed QA allowance');
      assert.equal(before.mode, '100644', 'Allowed QA differences must remain existing regular non-executable files');
      changedPaths.push(filename);
    }
  }
  return { application, qa, changedPaths };
}

function dependencyPaths(binding) {
  const sourceReader = path.join(binding.application.root, 'apps', 'reader');
  const qaReader = path.join(binding.qa.root, 'apps', 'reader');
  assert.ok(samePath(realpathSync.native(sourceReader), sourceReader), 'Application Reader directory must not be redirected');
  assert.ok(samePath(realpathSync.native(qaReader), qaReader), 'QA Reader directory must not be redirected');
  const sourceModules = path.join(sourceReader, 'node_modules');
  const modules = lstatSync(sourceModules);
  assert.ok(modules.isDirectory() && !modules.isSymbolicLink(), 'Application dependencies must belong to the application checkout');
  return { sourceReader, qaReader, sourceModules, qaModules: path.join(qaReader, 'node_modules') };
}

/** Only create the QA dependency link; never install or copy source/dependencies. */
export function linkQaDependencies(options) {
  const binding = verifyQaSource(options);
  const locations = dependencyPaths(binding);
  if (samePath(binding.application.root, binding.qa.root)) return binding;
  // lstat also catches dangling symlinks, unlike existsSync alone.
  let existing;
  try { existing = lstatSync(locations.qaModules); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(existing, undefined, 'Refusing an existing QA node_modules path or link');
  symlinkSync(locations.sourceModules, locations.qaModules, process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(samePath(realpathSync.native(locations.qaModules), realpathSync.native(locations.sourceModules)), 'QA dependencies must resolve to the selected application dependencies');
  verifyQaSource(options);
  return binding;
}

function sharedDependencies(binding) {
  const locations = dependencyPaths(binding);
  if (!samePath(binding.application.root, binding.qa.root)) {
    assert.ok(lstatSync(locations.qaModules).isSymbolicLink(), 'Separate QA must use the explicit application dependency link');
    assert.ok(samePath(realpathSync.native(locations.qaModules), realpathSync.native(locations.sourceModules)), 'QA dependency link changed');
  }
  return locations;
}

/** Execute the fixed application-owned Vitest entry in QA cwd, under private-step logging. */
export function runHostContracts(options, vitest, args) {
  const binding = verifyQaSource(options);
  const locations = sharedDependencies(binding);
  const entry = path.join(locations.sourceModules, 'vitest', 'vitest.mjs');
  let selected;
  try { if (vitest && path.isAbsolute(vitest)) selected = realpathSync.native(vitest); } catch { /* Invalid caller-selected entry is never executed. */ }
  assert.ok(selected && samePath(selected, realpathSync.native(entry)), 'Only the selected application Vitest entry may run');
  assert.ok(statSync(entry).isFile(), 'Application Vitest entry is unavailable');
  try {
    execFileSync(process.execPath, [entry, 'run', ...args], { cwd: locations.qaReader, stdio: 'inherit', env: process.env });
  } finally {
    // A host test may write ignored synthetic artifacts, but cannot alter either
    // checkout's tracked compiled inputs or its declared immutable HEAD.
    sharedDependencies(verifyQaSource(options));
  }
}

function regularQaEntry(locations, name) {
  const entry = path.join(locations.qaReader, 'scripts', name);
  const info = lstatSync(entry);
  assert.ok(info.isFile() && !info.isSymbolicLink() && samePath(realpathSync.native(entry), entry), 'QA entry must be its fixed regular source file');
  return entry;
}

function runFixedQa(options, entryName, args) {
  const binding = verifyQaSource(options);
  const locations = sharedDependencies(binding);
  const entry = regularQaEntry(locations, entryName);
  try {
    execFileSync(process.execPath, [...args.before, entry, ...args.after], { cwd: locations.sourceReader, stdio: 'inherit', env: process.env });
  } finally {
    sharedDependencies(verifyQaSource(options));
  }
}

/** Run only the fixed owned-volume regression; application Node contracts stay separate. */
export function runVolumeContracts(options) {
  runFixedQa(options, 'desktop-profile-storage-probe.test.mjs', { before: ['--test'], after: [] });
}

function applicationCandidate(locations, selected) {
  assert.ok(selected && path.isAbsolute(selected), 'Volume QA requires an absolute application candidate directory');
  const base = path.join(locations.sourceReader, 'release', 'core');
  assert.ok(samePath(realpathSync.native(base), base), 'Application candidate root must not be redirected');
  const candidate = realpathSync.native(selected);
  assert.ok(samePath(path.dirname(candidate), base), 'Volume QA candidate must be a direct application-owned core target');
  const info = lstatSync(path.join(candidate, 'desktop-artifacts.json'));
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Volume QA requires a regular application artifact index');
  const index = JSON.parse(readFileSync(path.join(candidate, 'desktop-artifacts.json'), 'utf8'));
  assert.equal(index.schemaVersion, 1, 'Unknown volume QA artifact index');
  assert.equal(index.profile, 'core', 'Volume QA candidate must retain the core profile');
  assert.equal(index.platform, process.platform, 'Volume QA candidate platform differs from its native host');
  assert.equal(index.arch, process.arch, 'Volume QA candidate architecture differs from its native host');
  assert.equal(path.basename(candidate), `${index.platform}-${index.arch}`, 'Volume QA candidate target differs from its artifact index');
  const sourcePackage = JSON.parse(readFileSync(path.join(locations.sourceReader, 'package.json'), 'utf8'));
  assert.equal(index.version, sourcePackage.version, 'Volume QA candidate version differs from application source');
  assert.match(index.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Invalid volume QA candidate version');
  return candidate;
}

/** No arbitrary scripts or arguments: use one unchanged packaged-volume QA entry. */
export function runVolumeQa(options, entryName, selectedCandidate) {
  assert.ok(volumeQaEntries.includes(entryName), 'Only fixed packaged volume QA entries may run');
  const binding = verifyQaSource(options);
  const locations = sharedDependencies(binding);
  const candidate = applicationCandidate(locations, selectedCandidate);
  runFixedQa(options, entryName, { before: [], after: [candidate] });
}

export function recordQaSource(options, output) {
  const binding = verifyQaSource(options);
  sharedDependencies(binding);
  assert.equal(path.basename(output), 'desktop-qa-source.json', 'Use the fixed candidate QA provenance filename');
  const base = realpathSync.native(path.join(binding.application.root, 'apps', 'reader', 'release', 'core'));
  const parent = realpathSync.native(path.dirname(path.resolve(output)));
  const relative = path.relative(base, parent);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'QA provenance must be written inside the application candidate directory');
  const index = JSON.parse(readFileSync(path.join(parent, 'desktop-artifacts.json'), 'utf8'));
  assert.equal(path.basename(parent), `${index.platform}-${index.arch}`, 'QA provenance target differs from finalized candidate');
  const receipt = {
    schemaVersion: 1,
    applicationSourceSha: binding.application.head,
    qaSourceSha: binding.qa.head,
    allowedChangedPaths: [...allowedQaChangedPaths],
    changedPaths: [...binding.changedPaths],
    allowedChangedPath: allowedQaChangedPath,
    allowedTestDiffers: binding.changedPaths.includes(allowedQaChangedPath),
  };
  writeFileSync(path.join(parent, 'desktop-qa-source.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return receipt;
}

function main() {
  const [action, ...raw] = process.argv.slice(2);
  assert.ok(['verify', 'link', 'check-clean', 'run-host-contracts', 'run-volume-contracts', 'run-volume-qa', 'record'].includes(action), 'Unknown QA source verification operation');
  const separator = raw.indexOf('--');
  const flags = separator < 0 ? raw : raw.slice(0, separator);
  const args = separator < 0 ? [] : raw.slice(separator + 1);
  const { values } = parseArgs({ args: flags, options: {
    source: { type: 'string' }, 'source-ref': { type: 'string' },
    'qa-source': { type: 'string' }, 'qa-ref': { type: 'string' },
    vitest: { type: 'string' }, output: { type: 'string' },
    entry: { type: 'string' }, candidate: { type: 'string' },
  } });
  const options = { source: values.source, sourceRef: values['source-ref'], qaSource: values['qa-source'] || undefined, qaRef: values['qa-ref'] || undefined };
  assert.ok(action === 'run-host-contracts' || (!values.vitest && !args.length), 'Only host contracts accept a Vitest entry and arguments');
  assert.ok(action === 'record' || !values.output, 'Only provenance recording accepts an output path');
  assert.ok(action === 'run-volume-qa' || (!values.entry && !values.candidate), 'Only packaged volume QA accepts an entry and candidate');
  if (action === 'link') linkQaDependencies(options);
  else if (action === 'run-host-contracts') runHostContracts(options, values.vitest, args);
  else if (action === 'run-volume-contracts') runVolumeContracts(options);
  else if (action === 'run-volume-qa') runVolumeQa(options, values.entry, values.candidate);
  else if (action === 'record') recordQaSource(options, values.output);
  else verifyQaSource(options);
  console.log(action === 'record' ? 'Recorded separate application and reviewed QA source provenance' : 'Verified immutable application and limited host-test source without changing build inputs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
