import { readFileSync } from 'node:fs';
import { verifyCandidateOnline } from './verify-portable-baseline.mjs';
const baselines = JSON.parse(readFileSync(new URL('./offline-baselines.json', import.meta.url), 'utf8'));
await verifyCandidateOnline(process.env.OFFLINE_TARGET, baselines);
