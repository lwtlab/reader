import { appendFileSync, readFileSync } from 'node:fs';
const targets = JSON.parse(readFileSync(new URL('./targets.json', import.meta.url), 'utf8'));
const baselines = JSON.parse(readFileSync(new URL('./upgrade-baselines.json', import.meta.url), 'utf8'));
const requested = process.env.BUILD_TARGET || 'all';
const selected = requested === 'all' ? targets : targets.filter(target => target.id === requested);
if (selected.length === 0) throw new Error('Unsupported build target');
const matrix = selected.map(target => {
  const baseline = baselines[target.id];
  if (!baseline) throw new Error('Missing approved upgrade baseline');
  return {...target, baseline_run_id: baseline.run_id, baseline_artifact_id: baseline.artifact_id};
});
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
