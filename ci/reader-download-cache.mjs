// Public cache policy is independently owned by the public workflow. Never cache
// Reader's pnpm store: it includes private file: application packages.
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function validatePublicRegistryLock(lock) {
  assert.equal(lock.lockfileVersion, 3); assert(lock.packages && Object.keys(lock.packages).length > 0);
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert(!entry.link && /^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? ''));
    const url = new URL(entry.resolved);
    assert.equal(url.protocol, 'https:');
    assert(['registry.npmjs.org', 'registry.npmmirror.com'].includes(url.hostname));
    assert(!url.username && !url.password && !url.port && !url.search && !url.hash);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = path.resolve('source/apps/reader-mobile/package-lock.json');
    const info = lstatSync(file); assert(info.isFile() && !info.isSymbolicLink() && info.size <= 8 * 1024 * 1024);
    validatePublicRegistryLock(JSON.parse(readFileSync(file, 'utf8')));
    console.log('Public registry download cache policy verified');
  } catch { console.error('Public registry cache policy failed; no dependency contents are published'); process.exitCode = 1; }
}
