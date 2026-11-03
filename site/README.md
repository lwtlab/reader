# Reader website

Static landing page, download directory and Markdown user guides. Built with pinned Astro 7.4.5
and Node 24; no private product package or server is imported. See
[public repository maintenance](../docs/maintaining.md) for setup, release compatibility and gated
deployment. The product API remains at its existing address.

The first implementation follows Reader's warm neutral palette, restrained amber accents, clear
keyboard focus and readable typography. Its task path is landing → start the web app or read a guide
→ choose an available download. Android links refer to the existing published v0.22.0 APK; desktop,
iOS and the extension store entry remain explicitly unavailable. The reading sample is an original
static illustration, not an interactive screenshot or a claim of on-device verification.

This initial structure implements the authorized repository/site foundation. Visual design has not
received user signoff. Browser checks cover the landing, download and tutorial paths at desktop and
320/390px widths, focus/navigation and dark mode; exact execution results are recorded in the PR.
No analytics, account session or user source content is collected by the site.
