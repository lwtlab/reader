import { readFileSync } from 'node:fs';
import { verifyCandidateOnline } from './verify-portable-baseline.mjs';
const approved = JSON.parse(readFileSync(new URL('./macos-signing-baselines.json', import.meta.url), 'utf8'));
await verifyCandidateOnline(process.env.MACOS_TARGET, approved);
