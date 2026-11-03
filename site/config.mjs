export const siteBase = process.env.SITE_BASE ?? '/reader/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(siteBase)) throw new Error('SITE_BASE must be / or a slash-delimited path such as /reader/');
export const siteOrigin = process.env.SITE_URL ?? 'https://lwtlab.github.io';
const parsed = new URL(siteOrigin);
if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('SITE_URL must be an HTTPS origin');
