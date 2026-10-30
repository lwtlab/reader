import { appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { baselines } from './verify-portable-baseline.mjs';
assert.match(process.env.QA_SOURCE_REF ?? '', /^[a-f0-9]{40}$/);
const target = process.env.PORTABLE_TARGET || 'all';
const selected = Object.entries(baselines).filter(([id]) => target === 'all' || target === id).map(([id, data]) => ({ id, ...data }));
assert.ok(selected.length > 0);
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(selected)}\n`);
