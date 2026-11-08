import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('internal candidate workflow stays manual and only uploads bounded artifacts and encrypted logs', () => {
  const yaml = readFileSync(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8');
  assert.match(yaml, /internal:\n[\s\S]*?default: false/);
  const internal = yaml.slice(yaml.indexOf('  internal-build:'));
  assert.match(internal, /if: inputs.internal/);
  assert.match(internal, /node-version: 24\.22\.0/);
  assert.match(internal, /node ci\/private-step\.mjs speech source/);
  assert.match(internal, /node ci\/seal-log\.mjs/);
  assert.match(internal, /--profile=bundled-speech --unsigned[\s\S]*?--publish never/);
  assert.doesNotMatch(internal, /release create|publish-release|contents: write|pull_request_target/);
  assert.doesNotMatch(internal.slice(internal.indexOf('Upload internal candidates only')), /path: source\s*$/m);
});
