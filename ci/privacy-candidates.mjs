import { readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { scanReleasePrivacy } from '../scripts/release-privacy.mjs';

const directory = path.resolve(process.argv[2]);
const names = readdirSync(directory).filter(name => /\.(dmg|zip|exe|AppImage|deb|apk|aab|ipa|blockmap|ya?ml|json)$|^SHA256SUMS$/.test(name));
if (!names.length) throw new Error('No final candidate files to audit');
if (names.length > 64) throw new Error('Final candidate file count bound exceeded');
for (const name of names) {
  const file = path.join(directory, name);
  if (!lstatSync(file).isFile()) throw new Error('Non-regular candidate');
  const report = await scanReleasePrivacy(file, { projectDir: process.env.READER_PRIVACY_TOOLS, plainFile: true, profile: 'desktop',
    onAsarUnclassifiedMatch: details => console.error(JSON.stringify({ kind: 'candidate-asar-unclassified-match', artifact: name, ...details })) });
  if (report.status !== 'PASS') {
    // private-step encrypts this stream; never include matched bytes or source lines.
    console.error(JSON.stringify({ kind: 'candidate-privacy-block', artifact: name,
      artifactSha256: report.artifactSha256, hashKind: report.hashKind, scanner: report.scanner,
      findingCount: report.findings.length, findings: report.findings.slice(0, 32),
      truncated: report.findings.length > 32 }));
    throw new Error('Final candidate privacy gate blocked');
  }
  console.log(JSON.stringify({ kind: 'candidate-privacy-pass', artifact: name,
    artifactSha256: report.artifactSha256, hashKind: report.hashKind,
    scanner: report.scanner, filesScanned: report.filesScanned }));
}
console.log(`Release privacy gate passed for ${names.length} candidate files`);
