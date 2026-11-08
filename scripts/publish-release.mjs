import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const releaseRepository = 'lwtlab/reader';
const root = fileURLToPath(new URL('..', import.meta.url));

export function releaseIdentity(product, version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Stable x.y.z version required');
  assert.ok(['desktop', 'mobile', 'extension'].includes(product), 'Unknown product');
  return {
    repository: releaseRepository,
    product,
    version,
    tag: product === 'mobile' ? `v${version}` : `${product}/v${version}`,
    latest: product === 'mobile',
  };
}

export async function releaseManifest({ product, version, sourceSha, publicSha, assets }) {
  const identity = releaseIdentity(product, version);
  assert.match(sourceSha, /^[a-f0-9]{40}$/, 'Full private source SHA required');
  assert.match(publicSha, /^[a-f0-9]{40}$/, 'Full public commit SHA required');
  assert.ok(assets.length, 'At least one release asset required');
  const names = assets.map(file => path.basename(file));
  assert.equal(new Set(names).size, names.length, 'Duplicate asset basenames');
  assert.ok(!names.some(name => ['reader-release.json', 'release-notes.md'].includes(name)), 'Reserved publisher filename');
  const expected = product === 'mobile' ? `lwt-reader-${version}.apk` : `reader-clipper-v${version}.zip`;
  if (product !== 'desktop') assert.ok(names.includes(expected), `Missing ${expected}`);
  else {
    assert.ok(names.some(name => name.startsWith(`Reader-${version}-`) && /\.(dmg|exe|deb|AppImage|zip)$/.test(name)), 'Desktop installer required');
  }
  const files = [];
  for (const file of assets) {
    const stat = statSync(file);
    assert.ok(stat.isFile() && stat.size > 0, 'Nonempty regular release files required');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    files.push({ name: path.basename(file), bytes: stat.size, sha256: hash.digest('hex') });
  }
  return {
    schemaVersion: 1,
    ...identity,
    source: { repository: 'lwtlab/lwt-core', commit: sourceSha },
    delivery: { repository: releaseRepository, commit: publicSha },
    // Hashes and provenance do not certify signing or application acceptance.
    verification: 'not-certified-by-publisher',
    assets: files,
  };
}

export function releaseCommands(manifest, notes, assets, manifestFile) {
  const { tag, product, version, latest, delivery } = manifest;
  return [
    ['release', 'create', tag, '--repo', releaseRepository, '--target', delivery.commit,
      '--draft', '--title', `Reader ${product} ${version}`, '--notes-file', notes,
      ...assets, manifestFile],
    // Publish only after every upload succeeded. A failed create leaves a draft.
    ['release', 'edit', tag, '--repo', releaseRepository, '--draft=false', `--latest=${latest}`],
  ];
}

export async function publishRelease(args = process.argv.slice(2), { run = execFileSync, log = console.log } = {}) {
  const { values } = parseArgs({ args, options: {
    product: { type: 'string' }, version: { type: 'string' },
    'source-sha': { type: 'string' }, notes: { type: 'string' },
    asset: { type: 'string', multiple: true }, publish: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    log('Usage: node scripts/publish-release.mjs --product mobile|desktop|extension --version x.y.z --source-sha <40 hex> --notes <file> --asset <file> [--asset <file>] [--publish]');
    log('Default: plan-only. --publish uploads a draft, then publishes; only mobile becomes Latest.');
    return;
  }
  const publicSha = run('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const assets = (values.asset ?? []).map(file => path.resolve(file));
  const notes = path.resolve(values.notes ?? '');
  assert.ok(readFileSync(notes, 'utf8').trim(), 'Release notes required');
  const manifest = await releaseManifest({
    product: values.product, version: values.version, sourceSha: values['source-sha'], publicSha, assets,
  });
  if (!values.publish) {
    log(JSON.stringify({ mode: 'plan-only', manifest }, null, 2));
    return;
  }
  assert.equal(run('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Commit public changes before publishing');
  // Check the target in the PUBLIC repository; never target a private source commit.
  const remote = run('gh', ['api', `repos/${releaseRepository}/commits/${publicSha}`, '--jq', '.sha'], { encoding: 'utf8' }).trim();
  assert.equal(remote, publicSha, 'Public commit must already be pushed');
  const directory = mkdtempSync(path.join(tmpdir(), 'reader-release-'));
  try {
    const staged = assets.map(file => {
      const target = path.join(directory, path.basename(file));
      copyFileSync(file, target);
      return target;
    });
    const snapshot = await releaseManifest({
      product: values.product, version: values.version, sourceSha: values['source-sha'], publicSha, assets: staged,
    });
    assert.deepEqual(snapshot.assets, manifest.assets, 'Release inputs changed while staging');
    const stagedNotes = path.join(directory, 'release-notes.md');
    const notesText = readFileSync(notes, 'utf8');
    writeFileSync(stagedNotes, notesText);
    const manifestFile = path.join(directory, 'reader-release.json');
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const args of releaseCommands(manifest, stagedNotes, staged, manifestFile)) {
      run('gh', args, { stdio: 'inherit' });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}
