import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fingerprint = 'DD53B80B69C61AB0A69F4080815BFF3E8724868B';
const runSecurity = (args) => execFileSync('/usr/bin/security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function paths(directory) {
  assert.ok(directory && path.isAbsolute(directory));
  const root = path.join(directory, 'reader-macos-signing');
  return { root, state: path.join(root, 'state.json'), keychain: path.join(root, 'reader.keychain-db'), p12: path.join(root, 'developer-id.p12'), key: path.join(root, 'notary.p8') };
}
export function cleanupSigning(directory, run = runSecurity) {
  const p = paths(directory);
  if (!existsSync(p.root)) return;
  assert.ok(lstatSync(p.root).isDirectory() && !lstatSync(p.root).isSymbolicLink());
  const state = JSON.parse(readFileSync(p.state, 'utf8'));
  assert.equal(state.kind, 'reader-macos-signing-v1');
  assert.equal(state.keychain, p.keychain);
  assert.ok(state.original.length > 0 && state.original.every((item) => path.isAbsolute(item)));
  let failed = false;
  try { run(['list-keychains', '-d', 'user', '-s', ...state.original]); } catch { failed = true; }
  try { if (existsSync(p.keychain)) run(['delete-keychain', p.keychain]); } catch { failed = true; }
  // Encrypted export and API key are deleted even if a keychain command fails.
  rmSync(p.root, { recursive: true, force: true });
  if (failed) throw new Error('macOS signing credential cleanup failed');
}
export function prepareSigning(directory, githubEnv, env = process.env, run = runSecurity) {
  const p = paths(directory);
  assert.ok(!existsSync(p.root), 'Refusing to replace signing state');
  const required = ['MACOS_SIGNING_P12_BASE64', 'MACOS_SIGNING_P12_PASSWORD', 'MACOS_NOTARY_P8_BASE64', 'MACOS_NOTARY_KEY_ID', 'MACOS_NOTARY_ISSUER_ID'];
  assert.ok(required.every((name) => env[name]), 'Missing macos-signing environment credentials');
  const original = [...run(['list-keychains', '-d', 'user']).matchAll(/"([^"\n]+)"/g)].map((match) => match[1]);
  assert.ok(original.length > 0 && original.every((item) => path.isAbsolute(item)));
  mkdirSync(p.root, { mode: 0o700 });
  writeFileSync(p.state, JSON.stringify({ kind: 'reader-macos-signing-v1', original, keychain: p.keychain }), { flag: 'wx', mode: 0o600 });
  try {
    const decode = (value) => {
      const encoded = value.replace(/\s/g, '');
      assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/);
      const bytes = Buffer.from(encoded, 'base64');
      assert.equal(bytes.toString('base64'), encoded);
      return bytes;
    };
    const p12 = decode(env.MACOS_SIGNING_P12_BASE64);
    assert.ok(p12.length > 64);
    const key = decode(env.MACOS_NOTARY_P8_BASE64);
    assert.equal(createPrivateKey(key).asymmetricKeyType, 'ec');
    assert.match(env.MACOS_NOTARY_KEY_ID, /^[A-Z0-9]{10,}$/);
    assert.match(env.MACOS_NOTARY_ISSUER_ID, /^[a-f0-9-]{36}$/i);
    writeFileSync(p.p12, p12, { flag: 'wx', mode: 0o600 });
    writeFileSync(p.key, key, { flag: 'wx', mode: 0o600 });
    const password = randomBytes(32).toString('hex');
    run(['create-keychain', '-p', password, p.keychain]);
    run(['set-keychain-settings', '-lut', '21600', p.keychain]);
    run(['unlock-keychain', '-p', password, p.keychain]);
    run(['list-keychains', '-d', 'user', '-s', p.keychain, ...original]);
    run(['import', p.p12, '-k', p.keychain, '-P', env.MACOS_SIGNING_P12_PASSWORD, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
    run(['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, p.keychain]);
    const found = run(['find-identity', '-v', '-p', 'codesigning', p.keychain]);
    const identities = [...found.matchAll(/^\s*\d+\) ([A-F0-9]{40}) "([^"\n]+)"/gm)];
    assert.equal(identities.length, 1, 'Export only the approved Developer ID identity');
    assert.equal(identities[0][1], fingerprint);
    assert.match(identities[0][2], /^Developer ID Application: .+\(N4HQH532K9\)$/);
    rmSync(p.p12);
    appendFileSync(githubEnv, `CSC_KEYCHAIN=${p.keychain}\nREADER_MACOS_NOTARY_KEY=${p.key}\nREADER_MACOS_NOTARY_KEY_ID=${env.MACOS_NOTARY_KEY_ID}\nREADER_MACOS_NOTARY_ISSUER_ID=${env.MACOS_NOTARY_ISSUER_ID}\n`);
    return { keychain: p.keychain, key: p.key };
  } catch {
    try { cleanupSigning(directory, run); } catch { /* Report a generic setup error, never raw secret arguments. */ }
    throw new Error('macOS signing credential setup failed; private arguments omitted');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, 'darwin');
  if (process.argv[2] === 'prepare') prepareSigning(process.env.RUNNER_TEMP, process.env.GITHUB_ENV);
  else if (process.argv[2] === 'cleanup') cleanupSigning(process.env.RUNNER_TEMP);
  else throw new Error('Use macos-signing.mjs prepare|cleanup');
  console.log('macOS signing credentials ' + (process.argv[2] === 'prepare' ? 'prepared in an isolated keychain' : 'cleaned up'));
}
