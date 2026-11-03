import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteBase } from '../config.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
let count = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.html')) {
      count++;
      const html = readFileSync(file, 'utf8');
      assert.match(html, /<html[^>]+lang="zh-CN"/);
      assert.match(html, /<main[^>]+id="main"/);
      assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, `${file}: one page heading`);
      for (const [, raw] of html.matchAll(/(?:href|src)="([^"\s]+)"/g)) {
        if (/^(https?:|mailto:|data:|#)/.test(raw)) continue;
        const url = new URL(raw, `https://example.com${siteBase}`);
        assert.ok(url.pathname.startsWith(siteBase), `Link escaped site base: ${raw}`);
        const relative = decodeURIComponent(url.pathname.slice(siteBase.length));
        const target = path.join(dist, relative);
        assert.ok(existsSync(target) || existsSync(path.join(target, 'index.html')), `${file}: broken link ${raw}`);
      }
    }
  }
}
walk(dist);
assert.ok(count >= 6, 'Landing, downloads, guide index and three guides required');
console.log(`Verified ${count} static pages and local links at ${siteBase}`);
