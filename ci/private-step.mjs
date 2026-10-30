import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, openSync } from 'node:fs';
import path from 'node:path';

const [phase, workingDirectory, command, ...args] = process.argv.slice(2);
if (!/^[a-z-]+$/.test(phase ?? '') || !['source', 'source/apps/reader'].includes(workingDirectory) || !command) throw new Error('Invalid build step');
const log = path.join(process.env.RUNNER_TEMP, 'reader-private-build.log');
appendFileSync(log, `\n--- ${phase} ---\n`, { mode: 0o600 });
const fd = openSync(log, 'a', 0o600);
let result;
try {
  // Workflow commands and arguments are fixed by trusted maintainers. A shell
  // is necessary for pnpm.cmd on Windows; no workflow input enters this list.
  result = spawnSync(command, args, { cwd: path.resolve(workingDirectory),
    shell: process.platform === 'win32', stdio: ['ignore', fd, fd], env: process.env });
} finally { closeSync(fd); }
if (result.error || result.status !== 0) {
  console.error(`${phase} failed; details are in the encrypted build log.`);
  process.exit(1);
}
console.log(`${phase} passed`);
