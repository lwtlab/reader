import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function hasEngineTransfer(rows, target) {
  if (!/^desktop-(darwin-(arm64|x64)|linux-x64|win32-x64)$/.test(target)) throw new Error('Desktop cache target required');
  const matches = rows.filter(row => row.name === `reader-engine-cache-${target}-new` && !row.expired);
  if (matches.length > 1) throw new Error('Ambiguous engine cache transfer');
  return matches.length === 1;
}

if (process.env.GITHUB_ACTIONS === 'true' && process.argv[1]?.endsWith('/engine-cache-transfer.mjs')) {
  if (process.env.GITHUB_REPOSITORY !== 'lwtlab/reader' || !/^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ID || '')) throw new Error('Trusted current run required');
  const result = JSON.parse(execFileSync('gh', ['api', `repos/lwtlab/reader/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts?per_page=100`, '--paginate', '--slurp'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  const present = hasEngineTransfer(result.flatMap(page => page.artifacts), process.env.RELEASE_TARGET);
  appendFileSync(process.env.GITHUB_OUTPUT, `present=${present}\n`);
}
