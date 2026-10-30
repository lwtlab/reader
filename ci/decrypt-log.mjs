import { readFileSync, writeFileSync } from 'node:fs';
import { decryptLog } from './log-crypto.mjs';

const [input, privateKey, output] = process.argv.slice(2);
if (!input || !privateKey || !output) throw new Error('Usage: node ci/decrypt-log.mjs <encrypted-log> <private-key> <new-output-file>');
writeFileSync(output, decryptLog(JSON.parse(readFileSync(input, 'utf8')), readFileSync(privateKey)), { flag: 'wx', mode: 0o600 });
console.log('Log decrypted to the requested local file.');
