import { appendFileSync, readFileSync } from 'node:fs';
const targets = JSON.parse(readFileSync(new URL('./targets.json', import.meta.url), 'utf8'));
const requested = process.env.BUILD_TARGET || 'all';
const selected = requested === 'all' ? targets : targets.filter(target => target.id === requested);
if (selected.length === 0) throw new Error('Unsupported build target');
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(selected)}\n`);
