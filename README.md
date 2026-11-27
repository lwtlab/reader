# Reader

Public delivery, website and user guides for [Reader](https://reader.cubbber.com/), across desktop, mobile and the Chrome companion. Application implementation stays in the private source repository.

See [repository maintenance](docs/maintaining.md) for product-scoped publishing, Android compatibility and independently gated website deployment. Website source is in [site/](site/); reviewed download metadata is in [manifests/](manifests/). Installers are Release assets, not Git files. Source pushes do not publish the site, submit a store listing or authorize a Release.

## Desktop delivery

Current published desktop downloads, exact hashes and version are recorded in [download metadata](manifests/channels.json) and the [website](https://lwtlab.github.io/reader/downloads/). macOS arm64/x64 provides DMG/ZIP, Windows x64 provides NSIS/Portable, and Linux x64 provides AppImage/DEB. Chrome Web Store submission remains excluded.

[Current platform signing status](manifests/desktop-signing-status.json): only macOS has Developer ID signatures and accepted Apple notarization. Windows and Linux remain unsigned. Project Ed25519 update metadata authenticates target/version and payload bytes; it does not provide an OS publisher identity or remove Windows Unknown publisher/SmartScreen warnings.

Published 0.26.0 installers keep updates disabled and require a manual installation of the first updater-enabled baseline. New enabled macOS, NSIS and AppImage builds separately request download and restart consent; ordinary Quit does not install. DEB authenticates/downloads before a separately confirmed system-installer handoff. Portable remains manual. The versioned archive and the dedicated production update feed have separate publication steps.

Workflow names alone do not identify a build lane:

Native candidates verify frozen source-input and original-notice bytes immediately after submodule
checkout, before installing native tools or Reader dependencies; this early integrity check does not
replace full dependency/notice coverage checks or make a redistribution decision.

The native candidate lane optionally accepts a separate immutable `qa_source_ref` for reviewed
host-test, owned-volume, Windows portable and renderer QA corrections. Both revision inputs use full lowercase 40-character
commit SHAs; empty QA means the application source remains the test source. The public verifier
compares complete tracked path, mode, blob and Gitlink maps and clean HEADs. Only these five
existing regular files may differ in bytes, with unchanged modes:

- `apps/reader/electron/main/appimage-install.test.ts`
- `apps/reader/scripts/desktop-storage-volume.mjs`
- `apps/reader/scripts/desktop-profile-storage-probe.test.mjs`
- `apps/reader/scripts/smoke-desktop-portable.mjs`
- `apps/reader/scripts/smoke-desktop-renderer.mjs`

Runtime, notices, dependency locks, metadata and every other application input must match.
The lifecycle/browser host contracts use the application's fixed Vitest entry in the QA checkout.
Before building, independent QA also runs only its fixed owned-volume Node regression; the original
application Node contract list stays intact. Packaged config-volume and library/review-volume checks
use only `smoke-desktop-storage.mjs` and `smoke-desktop-profile-storage.mjs` from the selected QA
source, with application cwd and an absolute application-owned candidate whose core target and
version match its artifact index. QA-owned/external candidates and arbitrary entries are rejected.
Windows single-file acceptance likewise uses only the fixed `smoke-desktop-portable.mjs` QA entry
on a native Windows host, retaining application cwd and the same candidate binding and timeout.
The fixed `run-window-qa` executor runs only the unchanged `smoke-desktop-window.mjs` entry,
which imports the reviewed renderer helper from the selected QA source. Its executable comes only
from `ci/targets.json` inside the absolute application candidate; redirected executables and extra
arguments are rejected. Checksums are prepared before window QA so the same strict artifact-index
binding applies. Linux retains the existing Xvfb outer wrapper and Openbox readiness/cleanup;
`ci/run-window-qa-linux.sh` invokes only this fixed executor. The window script's 45-second launch
budget and all acceptance assertions remain application-owned and unchanged.
The pinned Rust audit tool is installed after pre-build host checks, immediately before compilation;
the toolchain, checks and their original budgets remain in place.
The explicit dependency directory link (Windows junction) reuses the application dependencies;
there is no second install, file overlay or change to the compilation source.
Both tracked trees are rechecked after execution. Final candidates include `desktop-qa-source.json`
with separate application/QA SHAs, the fixed `allowedChangedPaths` array and actual `changedPaths`.
Compatibility fields identify only whether the original AppImage host test differs. The final privacy
gate scans the receipt before upload. Other contracts, compilation, packaging and native acceptance
continue to use the application checkout and its original source SHA.

| Lane | Scope | Signing and provenance |
| --- | --- | --- |
| `desktop-candidates.yml` on main | Four native core targets, one immutable private source SHA, synthetic QA; unsigned engineering packages | No Release; seven-day retention. `verify_upgrade=true` requires reviewed, available immutable [upgrade baselines](ci/upgrade-baselines.json) and a strictly increasing version. Explicit `verify_upgrade=false` is limited to deliberate baseline rebuilding and supplies no cross-version acceptance; the historical 0.26.0 replacement used that exception. Native installer replacement and the separate actual SDK auto-update lane certify different operations. |
| Separate `macos-signed-candidates.yml` | Signs/notarizes approved Mac binaries; does not compile | [Signing tuples](ci/macos-signing-baselines.json) identify exact successful platform jobs, main workflow origins, artifact IDs/digests and source. They must be reviewed into main before dispatch. Existing provenance, expiry, credentials cleanup, native QA and final-byte checks remain mandatory. |
| Separate `authenticate-desktop-updates.yml` | Authenticates exact final update metadata with a project-owned key; does not compile or code-sign applications | [Final update tuples](ci/update-signing-baselines.json) must pin reviewed final native outputs before dispatch. This is separate from platform code signing, uses the protected `desktop-updates` environment, and does not publish the production feed. |
| Separate `desktop-auto-update-acceptance.yml` | Runs actual native upgrades between two authenticated versions; does not build, sign or publish | [Upgrade pairs](ci/auto-update-baselines.json) pin each producer, digest, source and version plus an independent immutable QA runner. Empty approvals fail closed. Each native host preserves system signature checks where applicable, uses synthetic data, and uploads only the privacy-checked upgrade receipt and encrypted diagnostics. |
| `reader-internal-025-builds` full-product producer | Independently pinned tooling/application source; bundled speech plus other products/targets | Protected signing environments; not the core first-release lane. |

For each update-enabled versioned desktop archive, pass every final `desktop-artifacts.json`
entry to `scripts/publish-release.mjs`, including authenticated channel YML and blockmaps as well as
installers. The initial 0.26.0 installer-only attachment selection is historical, not the input list
for future update feeds. The publisher retains and scans these files without weakening its privacy
gate. Only after the immutable versioned archive is public and real upgrade QA qualifies its exact
payload may the private source's `promote-desktop-updates.mjs` promote a target to `desktop-stable`;
it defaults to a read-only plan, verifies archived bytes/source, uploads immutable payloads first and
replaces only the channel last. Neither archive nor update-feed publication may become Android Latest.

## Historical 0.26.0 baseline

The [core 0.26.0 archive](https://github.com/lwtlab/reader/releases/tag/desktop/v0.26.0) has eight installers and twelve attachments, with application/QA source `df4d7deee21fd3722eabb38a17f5990a1872c870`. Its Mac signing/notarization runs were [arm64 45841893369](https://github.com/lwtlab/reader/actions/runs/45841893369) and [Intel 45841936713](https://github.com/lwtlab/reader/actions/runs/45841936713). Windows/Linux were unsigned and every update policy was disabled. Its [acceptance snapshot](manifests/desktop-0.26.0-acceptance.json) retains exact hashes and the maintainer's manual-acceptance skip: unperformed and not passed. Historical evidence does not certify different installer bytes. Conservative source inventories and integrity receipts are not redistribution or publication grants; each actual payload must retain its applicable notices.

Desktop release/PR publication and website deployment were explicitly authorized on 2026-11-27. [Pages deployment](https://github.com/lwtlab/reader/actions/workflows/site-deploy.yml) remains separate from source pushes; [Reader Web](https://reader.cubbber.com/) remains the application/API host. Android Latest stays `v0.22.0`. Private hosted CI is not expected to run; local managed checks and public native CI provide their own evidence, and zero-step hosted failures are not passes.

[Reader Clipper 0.26.0](https://github.com/lwtlab/reader/releases/tag/extension/v0.26.0) is separately published as an official [manual-install ZIP](https://github.com/lwtlab/reader/releases/download/extension/v0.26.0/reader-clipper-v0.26.0.zip), with the compatible desktop version recorded in `extensionUnpacked.desktopVersion`. Its reviewed `extensionUnpacked` download metadata is independent of the still-null `extension` Chrome Web Store channel; no store submission is claimed. Follow the [unpacked installation and manual update guide](site/src/pages/guides/extension.md), and verify the Release's SHA256SUMS before loading it. The ZIP is 309272 bytes with SHA-256 `ffaf7c35a757c079beafb5a1bd9e2127a8de0347a8b5168526afd5ae0077b121`.

Earlier source851 engineering/signing results are preserved in the [previous immutable preparation record](https://github.com/lwtlab/reader/blob/0d0f62b3598a22bbe9b6713ff3cc51ef47fb8730/README.md#desktop-first-release). Those installers still have their then-known notice gaps and do not prove this correction. Source3f remains withdrawn. Independent portable/core/offline/storage probes continue to use only their explicitly selected immutable artifacts and fail closed on expiry; they are not new builds or acceptance of a new source. Overall failed/cancelled runs and successful platform jobs retain their separate scopes.

## Privacy and diagnostics

Public CI tests delivery tooling with synthetic payloads. Final candidate files, including ASAR contents and external resources, must pass `node scripts/release-privacy.mjs <candidate> --profile desktop --project-dir <ASAR-tools-directory>` before upload. Required tools are Gitleaks 8.30.1, Python 3, `@electron/asar`, and the relevant 7-Zip/squashfs or macOS hdiutil tools. CI installs them through `.github/actions/privacy-tools`. For publishing, `READER_PRIVACY_TOOLS` points to the ASAR tools directory.

Local regression checks also require `PRIVACY_TEST_TOOLS` to point to a directory containing `node_modules/@electron/asar@3.4.1`; the CI privacy-tools action sets this automatically.

Incomplete scans fail. The publisher checks staged asset hashes, notes and metadata before draft upload. Scanner rules, policy and synthetic regressions are exported from private source by `scripts/sync-release-privacy.mjs`; its check prevents drift. A clean pattern scan is not consent to distribute prose, screenshots, audio or user evidence; review attachments separately.

Private checkout and raw build logs are not public artifacts. Detailed diagnostics are encrypted using `ci/build-logs-public.pem` and retained for three days; the matching private key stays with the maintainer. Candidate artifacts retain their original expiry. Local decryption:

```sh
node ci/decrypt-log.mjs reader-private-build.log.enc.json /secure/path/build-logs-private.pem /secure/path/build.log
```

Runtime JavaScript remains readable in Electron packages. Packaging omits development metadata/source maps; no binary confidentiality claim is made. Production launchers retain the Chromium sandbox. Explicit AppImage compatibility and restricted offline QA that disable it require separate, clearly scoped evidence.

The 0.1.x development chronology, original failures, runs and local observations are retained in [historical candidate notes](README-history-2026-11-01.md). Those dates, temporary paths and credential-pending statements are historical, not current instructions or fresh acceptance receipts.
