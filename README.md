# Reader

Public delivery, website and user guides for [Reader](https://reader.cubbber.com/), across desktop, mobile and the Chrome companion. Application implementation stays in the private source repository.

See [repository maintenance](docs/maintaining.md) for product-scoped publishing, Android compatibility and independently gated website deployment. Website source is in [site/](site/); reviewed download metadata is in [manifests/](manifests/). Installers are Release assets, not Git files. Source pushes do not publish the site, submit a store listing or authorize a Release.

## Desktop first release

The preparation branch targets Electron **core 0.26.0**, macOS arm64/x64, Windows x64 and Linux x64, with Chrome companion 0.26.0. For this release, Windows NSIS and Portable packages are explicitly unsigned: there is no Reader Authenticode publisher identity, and Windows may show an unknown-publisher or SmartScreen warning. This is an accepted release limitation, not a successful signature check. macOS requires Developer ID signing/notarization. Automatic desktop updates remain disabled. The website keeps unavailable desktop/store URLs unset until actual files, identities and channels have been accepted.

Workflow names alone do not identify a build lane:

| Lane | Scope | Signing and provenance |
| --- | --- | --- |
| Core candidate workflow on the desktop preparation branch | Four native targets, private full source SHA, synthetic QA; unsigned engineering packages | No Release; seven-day candidate retention. `verify_upgrade=true` requires reviewed, unexpired immutable baselines. An explicit false builds a new baseline without claiming cross-version acceptance. |
| Separate `macos-signed-candidates.yml` | Signs and notarizes previously approved Mac binaries; does not compile | Verifies original successful upload, main-branch provenance, artifact ID, archive digest and expiry. The refreshed arm64 input is the successful platform job in main run 45777132115, source 85181a57a. Intel is being rebuilt after the aggregate job timeout; its old pinned entry is historical and must not be selected for this release. Dispatch arm64 only until a refreshed Intel tuple is separately approved. |
| `reader-internal-025-builds` full-product producer | Independently pinned tooling/application source; desktop currently bundled-speech, plus mobile/extension targets | Protected signing environments; not a core first-release dispatch merely because its workflow has the same filename. |

Current native follow-up: Linux, Windows and arm64 jobs for source `85181a57add13dd8d723e7a420a7a94a165beedb` passed in main run [45777132115](https://github.com/lwtlab/reader/actions/runs/45777132115), and their original installers passed independent exact-byte privacy/resource checks. Intel was cancelled at the 75-minute aggregate limit after the successful build/recovery stages, before offline validation, final privacy and upload completed; no Intel candidate from that run is approved. Only Intel's job budget is increased to 105 minutes; individual build/offline timeouts and all validation/upload gates remain required. The frozen application source is unchanged for the Intel retry.

As checked on 2026-11-26, all five macOS environment secrets are configured. `macos-signing` permits `main` and `reader-internal-025-builds`. Both previous 0.26.0 signing runs succeeded: [arm64 45745534235](https://github.com/lwtlab/reader/actions/runs/45745534235) and [Intel 45748483345](https://github.com/lwtlab/reader/actions/runs/45748483345). That cohort is now withdrawn from release selection for native dependency and notice follow-up; those exact-byte results do not certify replacement builds. All four targets must be rebuilt and the replacement Mac packages signed/notarized. For this core 0.26.0 release, manual installer/system-prompt acceptance is explicitly skipped, including replacements, without claiming a pass. [The decision](manifests/desktop-0.26.0-acceptance.json) preserves the withdrawn eight-artifact snapshot. Whole-product redistribution review and publication authorization remain required. Do not weaken provenance checks or use expired artifacts.

Independent portable/core/offline/storage workflows reuse only their explicitly approved immutable artifacts and fail closed on expiry. QA source and binary source are separate identities. They never turn a fixed old binary into a new source build. Scope, manual checks and current artifact hashes must be recorded per target and installer; one platform's success does not certify another.

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
