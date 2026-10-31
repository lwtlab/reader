import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupSigning, prepareSigning } from './macos-signing.mjs';
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-keychain-contract-'));
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const env = { MACOS_SIGNING_P12_BASE64: Buffer.alloc(128, 7).toString('base64'), MACOS_SIGNING_P12_PASSWORD: 'SYNTHETIC_PRIVATE_PASSWORD', MACOS_NOTARY_P8_BASE64: Buffer.from(key).toString('base64'), MACOS_NOTARY_KEY_ID: 'SYNTHETIC1', MACOS_NOTARY_ISSUER_ID: '00000000-0000-0000-0000-000000000001' };
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'list-keychains' && !args.includes('-s')) return '"/owned/original.keychain-db"';
    if (args[0] === 'create-keychain') writeFileSync(args.at(-1), 'owned synthetic keychain');
    if (args[0] === 'find-identity') return '  1) DD53B80B69C61AB0A69F4080815BFF3E8724868B "Developer ID Application: Reader QA (N4HQH532K9)"';
    return '';
  };
  return { root, env, key, calls, run };
}
test('isolates signing keys, exports only paths and restores keychain state on cleanup', () => {
  const f = fixture();
  try {
    const githubEnv = path.join(f.root, 'github-env');
    const result = prepareSigning(f.root, githubEnv, f.env, f.run);
    assert.equal(statSync(result.key).mode & 0o777, 0o600);
    const exported = readFileSync(githubEnv, 'utf8');
    assert.ok(!exported.includes(f.key) && !exported.includes(f.env.MACOS_SIGNING_P12_PASSWORD));
    assert.equal(existsSync(path.join(f.root, 'reader-macos-signing/developer-id.p12')), false);
    cleanupSigning(f.root, f.run);
    assert.equal(existsSync(path.dirname(result.key)), false);
    assert.deepEqual(f.calls.filter((a) => a[0] === 'list-keychains').at(-1), ['list-keychains', '-d', 'user', '-s', '/owned/original.keychain-db']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('import errors do not disclose credential arguments and still remove temporary keys', () => {
  const f = fixture();
  try {
    assert.throws(() => prepareSigning(f.root, path.join(f.root, 'env'), f.env, (args) => {
      if (args[0] === 'import') throw new Error(f.env.MACOS_SIGNING_P12_PASSWORD);
      return f.run(args);
    }), (error) => !error.message.includes(f.env.MACOS_SIGNING_P12_PASSWORD) && error.cause === undefined);
    assert.equal(existsSync(path.join(f.root, 'reader-macos-signing')), false);
    assert.throws(() => prepareSigning(f.root, path.join(f.root, 'env'), {}, f.run), /Missing/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
