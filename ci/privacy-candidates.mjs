import { readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { requireReleasePrivacy } from '../scripts/release-privacy.mjs';

const directory = path.resolve(process.argv[2]);
const names = readdirSync(directory).filter(name => /\.(dmg|zip|exe|AppImage|deb|apk|aab|ipa|blockmap|ya?ml|json)$|^SHA256SUMS$/.test(name));
if (!names.length) throw new Error('No final candidate files to audit');
for (const name of names) {
  const file = path.join(directory, name);
  if (!lstatSync(file).isFile()) throw new Error('Non-regular candidate');
  await requireReleasePrivacy(file, { projectDir: process.env.READER_PRIVACY_TOOLS, plainFile: true, profile: 'desktop' });
}
console.log(`Release privacy gate passed for ${names.length} candidate files`);
