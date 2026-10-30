import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encryptLog } from './log-crypto.mjs';

const input = path.join(process.env.RUNNER_TEMP, 'reader-private-build.log');
if (existsSync(input)) {
  const key = readFileSync(new URL('./build-logs-public.pem', import.meta.url));
  writeFileSync(`${input}.enc.json`, JSON.stringify(encryptLog(readFileSync(input), key)), { mode: 0o600 });
  rmSync(input);
  console.log('Build log encrypted for the maintainer; plaintext removed.');
}
