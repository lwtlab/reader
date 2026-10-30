import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

const [phase, workingDirectory, command, ...args] = process.argv.slice(2);
if (!/^[a-z-]+$/.test(phase ?? '') || !['source', 'source/apps/reader'].includes(workingDirectory) || !command) throw new Error('Invalid build step');
const log = path.join(process.env.RUNNER_TEMP, 'reader-private-build.log');
appendFileSync(log, `\n--- ${phase} ---\n`, { mode: 0o600 });
// Windows' system bash may resolve to WSL. Use the same Git Bash as Actions.
const executable = process.platform === 'win32' && command === 'bash'
  ? path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : command;
// Pipes keep Git Bash/MSYS compatible with Node's Windows output handles.
// Consume bounded chunks without forwarding private output to the public console.
const child = spawn(executable, args, { cwd: path.resolve(workingDirectory),
  shell: process.platform === 'win32' && command === 'pnpm',
  stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
for (const stream of [child.stdout, child.stderr]) {
  stream?.on('data', chunk => appendFileSync(log, chunk));
}
let error;
child.on('error', failure => { error = failure; });
const result = await new Promise(resolve => child.once('close', (status, signal) => resolve({ status, signal })));
if (error) appendFileSync(log, `Spawn error: ${error.stack ?? error.message}\n`);
appendFileSync(log, `Exit status: ${result.status}, signal: ${result.signal}\n`);
if (error || result.status !== 0) {
  console.error(`${phase} failed; details are in the encrypted build log.`);
  process.exit(1);
}
console.log(`${phase} passed`);
