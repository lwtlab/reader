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
  // Windows' system bash can resolve to the WSL launcher. Use Git Bash,
  // the shell used by Actions, and spawn native executables without cmd.exe.
  const executable = process.platform === 'win32' && command === 'bash'
    ? path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : command;
  // Only the fixed pnpm command needs its .cmd shim; no workflow input enters it.
  result = spawnSync(executable, args, { cwd: path.resolve(workingDirectory),
    shell: process.platform === 'win32' && command === 'pnpm',
    stdio: ['ignore', fd, fd], env: process.env });
} finally { closeSync(fd); }
if (result.error) appendFileSync(log, `Spawn error: ${result.error.stack ?? result.error.message}\n`);
appendFileSync(log, `Exit status: ${result.status}, signal: ${result.signal}\n`);
if (result.error || result.status !== 0) {
  console.error(`${phase} failed; details are in the encrypted build log.`);
  process.exit(1);
}
console.log(`${phase} passed`);
