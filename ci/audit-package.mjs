import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(process.argv[2]);
const require = createRequire(fileURLToPath(new URL('../source/apps/reader/package.json', import.meta.url)));
const asar = require('@electron/asar');
let archives = 0;
function visit(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.map')) throw new Error('Private source map found in distributable');
    else if (entry.name === 'app.asar') {
      archives++;
      if (asar.listPackage(file).some(name => name.endsWith('.map'))) throw new Error('Private source map found in app archive');
    }
  }
}
if (!existsSync(directory)) throw new Error('Packaged application is missing');
visit(directory);
if (archives !== 1) throw new Error('Expected exactly one application archive');
console.log('Packaged code source-map audit passed');
