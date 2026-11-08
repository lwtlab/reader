import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { auditPackagedSourceMaps } from './audit-package.mjs';

test('audits maps in every runtime archive while requiring one application archive', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-package-audit-'));
  try {
    mkdirSync(path.join(root, 'standalone'));
    writeFileSync(path.join(root, 'app.asar'), 'synthetic archive');
    writeFileSync(path.join(root, 'standalone', 'runtime.asar'), 'synthetic archive');
    const visited = [];
    auditPackagedSourceMaps(root, { listPackage(file) { visited.push(path.basename(file)); return ['/runtime.js']; } });
    assert.deepEqual(visited.sort(), ['app.asar', 'runtime.asar']);
    assert.throws(() => auditPackagedSourceMaps(root, {
      listPackage(file) { return path.basename(file) === 'runtime.asar' ? ['/server.js.map'] : ['/main.js']; },
    }), /Private source map/);
    writeFileSync(path.join(root, 'standalone', 'app.asar'), 'extra application archive');
    assert.throws(() => auditPackagedSourceMaps(root, { listPackage() { return []; } }), /exactly one/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('accepts exact proven public bytes and rejects changed or unproven maps', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-public-map-audit-'));
  try {
    const dependency = path.join(root, 'speech', 'tts', 'node_modules', 'public-dependency');
    mkdirSync(dependency, { recursive: true });
    writeFileSync(path.join(root, 'app.asar'), 'synthetic archive');
    const map = path.join(dependency, 'runtime.js.map');
    writeFileSync(map, 'synthetic known public bytes');
    const asar = { listPackage() { return ['/main.js']; } };
    assert.throws(() => auditPackagedSourceMaps(root, asar), /Private source map/);
    const proofs = new Map([[map, createHash('sha256').update('synthetic known public bytes').digest('hex')]]);
    auditPackagedSourceMaps(root, asar, proofs);
    writeFileSync(map, 'synthetic private replacement');
    assert.throws(() => auditPackagedSourceMaps(root, asar, proofs), /Private source map/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
