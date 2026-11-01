import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export function auditPackagedSourceMaps(directory, asar) {
  let applications = 0;
  function visit(root) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.map')) throw new Error('Private source map found in distributable');
      else if (entry.name.endsWith('.asar')) {
        if (entry.name === 'app.asar') applications++;
        if (asar.listPackage(file).some(name => name.endsWith('.map'))) {
          throw new Error('Private source map found in packaged archive');
        }
      }
    }
  }
  if (!existsSync(directory)) throw new Error('Packaged application is missing');
  visit(directory);
  if (applications !== 1) throw new Error('Expected exactly one application archive');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(fileURLToPath(new URL('../source/apps/reader/package.json', import.meta.url)));
  auditPackagedSourceMaps(path.resolve(process.argv[2]), require('@electron/asar'));
  console.log('Packaged code source-map audit passed');
}
