// Public infrastructure probe: no private checkout, application, or credentials.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(file, args) {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { output = (output + b).slice(-8000); });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve({ code, output }));
  });
}
if (process.argv[2] === 'child') {
  const wm = spawn('openbox', ['--sm-disable'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', ended = false;
  const done = new Promise(resolve => wm.once('close', code => { ended = true; resolve(code); }));
  for (const stream of [wm.stdout, wm.stderr]) stream.on('data', b => { output = (output + b).slice(-8000); });
  let ready = false;
  try {
    for (let i = 0; i < 40; i++) {
      if (ended) break;
      const result = await command('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK']);
      if (result.code !== 0) { console.error(result.output); break; }
      const id = /window id # (0x[0-9a-f]+)/i.exec(result.output)?.[1];
      if (id && Number.parseInt(id, 16) > 0) { ready = true; break; }
      await sleep(250);
    }
  } finally {
    if (!ended) wm.kill();
    await done;
  }
  if (!ready) { console.error(`DISPLAY=${process.env.DISPLAY}\n${output}`); process.exitCode = 1; }
} else {
  const mode = process.argv[2];
  if (!['default', 'noreset'].includes(mode)) throw new Error('Expected default or noreset');
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-display-probe-'));
  let failures = 0;
  try {
    for (let round = 0; round < 100; round++) {
      const log = path.join(root, `server-${round}.log`);
      const args = ['-a', '-e', log];
      if (mode === 'noreset') args.push('--server-args=-screen 0 1280x1024x24 -nolisten tcp -noreset');
      args.push(process.execPath, fileURLToPath(import.meta.url), 'child');
      const result = await command('xvfb-run', args);
      if (result.code !== 0) {
        failures++;
        console.error(`FAIL ${mode} round=${round} code=${result.code}\n${result.output}\n${readFileSync(log, 'utf8')}`);
      }
    }
    console.log(JSON.stringify({ mode, rounds: 100, failures }));
    if (failures) process.exitCode = 1;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
