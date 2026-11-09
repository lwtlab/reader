import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {hasEngineTransfer} from './engine-cache-transfer.mjs';

test('warm-cache builds skip publication and transfers cannot mix targets or expired artifacts',()=>{
 const row={name:'reader-engine-cache-desktop-linux-x64-new',expired:false};
 assert.equal(hasEngineTransfer([], 'desktop-linux-x64'),false);
 assert.equal(hasEngineTransfer([row], 'desktop-linux-x64'),true);
 assert.equal(hasEngineTransfer([{...row,expired:true}], 'desktop-linux-x64'),false);
 assert.equal(hasEngineTransfer([row], 'desktop-darwin-arm64'),false);
 assert.throws(()=>hasEngineTransfer([row,row], 'desktop-linux-x64'));
});
test('private engine credentials stay in broker jobs and cache files never enter public actions/cache',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/desktop-candidates.yml',import.meta.url),'utf8');
 const restore=yaml.slice(yaml.indexOf('  release-engine-cache-restore:'),yaml.indexOf('  release-native-producer:'));
 const native=yaml.slice(yaml.indexOf('  release-native-producer:'),yaml.indexOf('  release-engine-cache-publish:'));
 const publish=yaml.slice(yaml.indexOf('  release-engine-cache-publish:'));
 for(const broker of [restore,publish]) {
  assert.match(broker,/environment: reader-internal-release/);
  assert.match(broker,/GH_TOKEN: \$\{\{ secrets\.INTERNAL_RELEASE_PUBLISH_TOKEN \}\}/);
  assert.match(broker,/node ci\/private-step\.mjs engine-cache-/);
  assert.match(broker,/node ci\/seal-log\.mjs/);
  assert.doesNotMatch(broker,/pnpm install|scripts\/install\.sh|smoke-local|prepare-internal/);
 }
 assert.doesNotMatch(native,/INTERNAL_RELEASE_PUBLISH_TOKEN|GH_TOKEN:/);
 assert.match(native,/READER_ENGINE_CACHE_RESTORE/);
 assert.match(native,/READER_ENGINE_CACHE_OUTPUT/);
 assert.match(native,/retention-days: 1/);
});
