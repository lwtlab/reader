import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Exceptions are content proofs from the frozen npm integrity, never a directory exemption.
export async function publicDependencyMapProofs(directory, lock) {
  const groups = new Map();
  function visit(root) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.map') && file.split(path.sep).join('/').includes('/speech/tts/node_modules/')) {
        let packageRoot = path.dirname(file), metadata;
        while (packageRoot !== directory && packageRoot !== path.dirname(packageRoot)) {
          const candidate = path.join(packageRoot, 'package.json');
          if (existsSync(candidate)) {
            const value = JSON.parse(readFileSync(candidate, 'utf8'));
            if (typeof value.name === 'string' && typeof value.version === 'string') { metadata = value; break; }
          }
          packageRoot = path.dirname(packageRoot);
        }
        if (!metadata) throw new Error('Dependency map has no package identity');
        const key = `${metadata.name}@${metadata.version}`;
        const locked = lock.packages?.[key];
        if (!locked?.resolution?.integrity?.startsWith('sha512-')) throw new Error('Dependency map lacks frozen npm integrity');
        if (!groups.has(key)) groups.set(key, { metadata, integrity: locked.resolution.integrity, files: [] });
        groups.get(key).files.push({ file, entry: 'package/' + path.relative(packageRoot, file).split(path.sep).join('/') });
      }
    }
  }
  visit(path.resolve(directory));
  const proofs = new Map();
  for (const { metadata, integrity, files } of groups.values()) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(metadata.name)}/${encodeURIComponent(metadata.version)}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Public npm dependency metadata unavailable');
    const info = await response.json();
    const url = new URL(info.dist?.tarball);
    if (info.name !== metadata.name || info.version !== metadata.version || info.dist.integrity !== integrity || url.origin !== 'https://registry.npmjs.org') throw new Error('Public npm metadata disagrees with frozen dependency');
    const archive = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!archive.ok) throw new Error('Public npm dependency archive unavailable');
    const bytes = Buffer.from(await archive.arrayBuffer());
    if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== integrity) throw new Error('Public dependency archive integrity mismatch');
    const inspect = `import sys,tarfile,io,hashlib,json
result={}; total=0
with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:gz') as archive:
 for item in archive:
  if not item.isfile() or not item.name.endswith('.map'): continue
  if item.size>100*1024*1024: raise ValueError('oversized public source map')
  total+=item.size
  if total>300*1024*1024: raise ValueError('oversized public map inventory')
  result[item.name]=hashlib.sha256(archive.extractfile(item).read()).hexdigest()
print(json.dumps(result))`;
    const entries = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', inspect], { input: bytes, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
    for (const { file, entry } of files) {
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (entries[entry] !== sha) throw new Error('Packaged dependency map is not an exact locked public npm file');
      proofs.set(path.resolve(file), sha);
    }
  }
  return proofs;
}
