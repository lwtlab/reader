# Reader website

Static landing page, download directory and Markdown user guides. Built with pinned Astro 7.4.5
and Node 24; no private product package or server is imported. See
[public repository maintenance](../docs/maintaining.md) for setup, release compatibility and gated
deployment. The product API remains at its existing address.

The first implementation follows Reader's warm neutral palette, restrained amber accents, clear
keyboard focus and readable typography. Its task path is landing → start the web app or read a guide
→ choose an available download. Android links retain the existing published v0.22.0 APK. Desktop 0.26.0 and the manually loaded
Clipper ZIP are published; iOS and the Chrome store entry remain unavailable. The reading sample is an original
static illustration, not an interactive screenshot or a claim of on-device verification.

The existing site structure is authorized for deployment on 2026-11-27. Browser checks cover the landing, download and tutorial paths at desktop and
320/390px widths, focus/navigation and dark mode; exact execution results are recorded in the PR.
No analytics, account session or user source content is collected by the site.

## Desktop and companion publication metadata

The download page is prepared for macOS arm64/x64, Windows x64 and Linux x64 core.
The desktop guide covers installation, SHA-256 checks, private backups, manual updates and
explicit reduced-protection Linux AppImage launch. It is available before installers are released.
Availability remains controlled by `manifests/channels.json`; each channel remains null until its
actual public payload exists. Desktop and manual extension ZIP metadata now bind published assets;
the Chrome store channel remains null. Do not use candidate/CI URLs as public downloads.

After final-byte privacy, signature/native acceptance and actual publication, the desktop value is:

```text
{
  version: "<stable version>",
  updatePolicy: "manual",
  releaseUrl: "https://github.com/lwtlab/reader/releases/tag/desktop/v<VERSION>",
  checksumsUrl: "https://github.com/lwtlab/reader/releases/download/desktop/v<VERSION>/SHA256SUMS",
  assets: [{
    platform: "darwin" | "win32" | "linux",
    arch: "arm64" | "x64",  // arm64 only for macOS in this initial matrix
    profile: "core",
    name: "<actual final filename>",
    url: "https://github.com/lwtlab/reader/releases/download/desktop/v<VERSION>/<FILENAME>",
    sha256: "<64 lowercase hexadecimal characters>",
    bytes: <positive final byte size>
  }]
}
```

This is a schema illustration, not paste-ready published metadata. Names must match the reviewed
Reader version, OS, architecture and format: mac DMG/ZIP, win setup/portable EXE, linux DEB/AppImage.
Each platform displays only its own published assets; absent targets remain unavailable.
The build rejects foreign repositories, mismatched filenames/versions, incomplete checksums,
duplicate downloads and an automatic-update policy. Android's existing tag, APK and Latest remain untouched.

When Chrome Web Store installation is actually available, `extension` has `version`,
`desktopVersion` (matching the published companion) and `storeUrl` (the real official store URL,
including its actual 32-character extension ID). Until then it remains null. Do not invent an ID.
A store button appears only for verified metadata; the pairing guide remains accessible either way.
Manual ZIP delivery is a separate `extensionUnpacked` channel, with its own published version,
matching desktop version, exact official release/download URLs, filename, SHA-256 and byte size.
It can be available while the store channel is null. It is labelled manual installation and does not
claim Chrome store identity or automatic updates.
The static site does not infer compatibility, fetch GitHub Latest or collect browser OS/account data.

Run `npm --prefix site run verify` and `SITE_BASE=/ npm --prefix site run verify` before updating the
site; these include download contract tests. Verify actual external links separately, after the assets
and policy URL exist. Confirm the final hostname/base and applicable privacy/security links before deployment. Verify
store URLs when the store channel is enabled; a manual ZIP does not require a store listing.
Changing this JSON neither publishes an installer nor deploys Pages.
