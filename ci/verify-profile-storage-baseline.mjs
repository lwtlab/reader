import { readFileSync } from 'node:fs';
import { verifyCandidateOnline } from './verify-portable-baseline.mjs';
const baselines = JSON.parse(readFileSync(new URL('./profile-storage-baselines.json', import.meta.url), 'utf8'));
await verifyCandidateOnline(process.env.PROFILE_STORAGE_TARGET, baselines);
