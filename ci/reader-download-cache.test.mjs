import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublicRegistryLock } from './reader-download-cache.mjs';
const entry = { resolved: 'https://registry.npmjs.org/public/-/public.tgz', integrity: `sha512-${'A'.repeat(86)}==` };
const lock = change => ({ lockfileVersion: 3, packages: { '': { name: 'private-app' }, 'node_modules/public': { ...entry, ...change } } });
test('only public content-addressed registry downloads can enter the cache', () => {
  validatePublicRegistryLock(lock());
  for (const change of [{ resolved: 'file:../../story-core' }, { link: true }, { integrity: '' }, { resolved: 'https://private.invalid/pkg' }, { resolved: 'https://token@registry.npmjs.org/pkg' }, { resolved: 'https://registry.npmjs.org/pkg?token=secret' }]) assert.throws(() => validatePublicRegistryLock(lock(change)));
});
