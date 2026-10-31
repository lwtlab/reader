import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
const approved = JSON.parse(readFileSync(new URL('./macos-signing-baselines.json', import.meta.url), 'utf8'));
assert.match(process.env.QA_SOURCE_REF || '', /^[a-f0-9]{40}$/);
const required = ['darwin-arm64', 'darwin-x64'];
assert.deepEqual(Object.keys(approved).sort(), required);
assert.ok(process.env.MACOS_TARGET === 'all' || required.includes(process.env.MACOS_TARGET));
const matrix = Object.entries(approved).filter(([id]) => process.env.MACOS_TARGET === 'all' || id === process.env.MACOS_TARGET).map(([id, item]) => ({ id, ...item, arch: id.slice('darwin-'.length) }));
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
