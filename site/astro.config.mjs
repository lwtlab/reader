import { defineConfig } from 'astro/config';
import { siteBase, siteOrigin } from './config.mjs';

export default defineConfig({
  site: siteOrigin,
  base: siteBase,
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
});
