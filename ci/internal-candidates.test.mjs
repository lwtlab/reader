import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('internal candidate workflow stays manual and only uploads bounded artifacts and encrypted logs', () => {
  const yaml = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(yaml, /internal:\n[\s\S]*?default: false/);
  const internal = yaml.slice(yaml.indexOf('  internal-build:'), yaml.indexOf('  release-build-matrix:'));
  assert.match(internal, /if: inputs.internal/);
  assert.match(internal, /node-version: 24\.22\.0/);
  assert.match(internal, /node ci\/private-step\.mjs speech source/);
  assert.match(internal, /node ci\/seal-log\.mjs/);
  assert.match(internal, /--profile=bundled-speech --unsigned[\s\S]*?--publish never/);
  assert.doesNotMatch(internal, /release create|publish-release|contents: write|pull_request_target/);
  assert.doesNotMatch(internal.slice(internal.indexOf('Upload internal candidates only')), /path: source\s*$/m);
});

test('published baseline reads use an isolated credential job and native acceptance receives only artifacts',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/desktop-candidates.yml',import.meta.url),'utf8');
 const bootstrap=yaml.slice(yaml.indexOf('  upgrade-published-baseline:'),yaml.indexOf('  internal-upgrade:'));
 const native=yaml.slice(yaml.indexOf('  internal-upgrade:'),yaml.indexOf('  internal-build:'));
 assert.match(bootstrap,/environment: reader-internal-release/);assert.match(bootstrap,/GH_TOKEN: \$\{\{ secrets\.INTERNAL_RELEASE_PUBLISH_TOKEN \}\}/);
 assert.match(bootstrap,/scripts\/release-materialize\.mjs/);assert.doesNotMatch(bootstrap,/smoke-desktop|scripts\/install\.sh|release create/);
 assert.doesNotMatch(native,/INTERNAL_RELEASE_PUBLISH_TOKEN|INTERNAL_RELEASE_READ_TOKEN/);
 assert.match(native,/reader-published-\$\{\{ matrix\.id \}\}-baseline/);assert.match(native,/scripts\/release-desktop-acceptance\.mjs/);
});

test('native macOS producers prepare both media tools before private dependencies and signing',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/desktop-candidates.yml',import.meta.url),'utf8');
 const producer=yaml.slice(yaml.indexOf('  release-native-producer:'));
 const media=producer.indexOf('- name: Prepare macOS native media tools');
 assert.ok(media>=0 && media<producer.indexOf('- name: Verify immutable application'));
 assert.match(producer.slice(media,producer.indexOf('- name: Verify immutable application')),/if: matrix\.platform == 'darwin'[\s\S]*?command -v ffmpeg[\s\S]*?command -v ffprobe[\s\S]*?brew install ffmpeg/);
});
