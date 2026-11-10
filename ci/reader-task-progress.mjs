// Public, informational task progress. The independently verified final receipt
// remains the only authority for the required check.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TASKS, binding, positive } from './reader-verification.mjs';
const allowed = new Set(TASKS);
export function taskEvent(input) {
  if (!input || !allowed.has(input.id) || !['RUNNING', 'PASS', 'FAIL', 'NOT_RUN'].includes(input.status) ||
      !Number.isSafeInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 7 * 24 * 3600000) return null;
  return { id: input.id, status: input.status, durationMs: input.durationMs };
}
export function taskProgress({ root = process.cwd(), env = process.env, emit = line => console.log(line), now = Date.now } = {}) {
  const value = binding(JSON.parse(env.VERIFICATION_BINDING));
  if (env.GITHUB_SHA !== value.workflow) throw Error('Progress workflow identity mismatch');
  const run = positive(env.GITHUB_RUN_ID), attempt = positive(env.GITHUB_RUN_ATTEMPT);
  const started = now(), observed = new Map();
  const preparation = Number(env.READER_PREPARATION_STARTED_MS);
  const preparationDurationMs = Number.isSafeInteger(preparation) && preparation > 0 && preparation <= started && started - preparation <= 7 * 24 * 3600000 ? started - preparation : null;
  let timer, directoryId;
  function flush() {
    try {
      const directory = path.join(root, 'source/.artifacts/verify');
      if (!existsSync(directory) || lstatSync(directory).isSymbolicLink()) return;
      const entries = readdirSync(directory).filter(name => /^[a-f0-9-]{36}$/.test(name));
      if (entries.length !== 1 || directoryId && directoryId !== entries[0]) return;
      directoryId = entries[0];
      const runDirectory = path.join(directory, directoryId);
      if (lstatSync(runDirectory).isSymbolicLink()) return;
      const file = path.join(runDirectory, 'progress.jsonl');
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) return;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.pop(); // An incomplete append is retried on the next bounded poll.
      for (const line of lines) {
        if (line.length > 4096) continue;
        let raw; try { raw = JSON.parse(line); } catch { continue; }
        const event = taskEvent(raw); if (!event) continue;
        const previous = observed.get(event.id);
        if (previous?.status === event.status || previous && previous.status !== 'RUNNING') continue;
        if (['PASS', 'FAIL'].includes(event.status) && previous?.status !== 'RUNNING') continue;
        observed.set(event.id, event);
        emit(`Task progress (informational): ${JSON.stringify(event)}`);
      }
    } catch { /* Missing/invalid progress can never turn a final gate into PASS. */ }
  }
  return {
    start() { timer = setInterval(flush, 1000); timer.unref(); },
    flush,
    finish() {
      clearInterval(timer); flush();
      const report = { schemaVersion: 1, kind: 'reader-informational-task-progress', authoritative: false,
        binding: value, run, attempt, preparationDurationMs, graphDurationMs: Math.max(0, now() - started),
        tasks: TASKS.filter(id => observed.has(id)).map(id => observed.get(id)) };
      const output = path.join(root, 'verification-output'); mkdirSync(output, { recursive: true });
      writeFileSync(path.join(output, 'progress.json'), JSON.stringify(report, null, 2) + '\n');
      if (env.GITHUB_STEP_SUMMARY) {
        const rows = report.tasks.map(t => `| ${t.id} | ${t.status} | ${t.durationMs} |`).join('\n');
        appendFileSync(env.GITHUB_STEP_SUMMARY, `\n### Informational verification progress\n\nOnly the independently validated final receipt determines success.\n\nPreparation before graph: ${preparationDurationMs ?? 'unavailable'} ms. Graph wrapper: ${report.graphDurationMs} ms.\n\n| Task | Observed status | Duration ms |\n| --- | --- | --- |\n${rows}\n`);
      }
      return report;
    },
  };
}
