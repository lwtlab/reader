# Reader

Public delivery, website and user guides for [Reader](https://reader.cubbber.com/), across desktop, mobile and the Chrome companion. Application implementation stays in the private source repository.

See [repository maintenance](docs/maintaining.md) for product-scoped publishing, Android compatibility and independently gated website deployment. Website source is in [site/](site/); reviewed download metadata is in [manifests/](manifests/). Installers are Release assets, not Git files. Source pushes do not publish the site, submit a store listing or authorize a Release.

## Desktop first release

This round prepares Electron **core 0.26.0** for macOS arm64/x64, Windows x64 and Linux x64. Chrome Web Store submission is excluded. Windows NSIS and Portable are explicitly unsigned: there is no Reader Authenticode identity, and Windows may show an unknown-publisher or SmartScreen warning. This is an accepted limitation, not successful publisher verification. macOS requires Developer ID signing/notarization; Linux includes both AppImage and DEB. Automatic updates remain disabled.

The application and QA source for this material correction is `df4d7deee21fd3722eabb38a17f5990a1872c870`. It adds local third-party attribution, preserves original publisher declarations and clearly labelled standard-license supplements where upstream supplied no separate notice, and removes unreachable sharp/libvips from unoptimized Next standalone builds. A conservative source inventory can include build-only/unshipped components and supplemental declarations; its incomplete status is not a list of automatic current-payload blockers. Integrity checks do not grant redistribution or publication approval. Exact final payloads must retain their applicable notices and pass their own checks.

Workflow names alone do not identify a build lane:

| Lane | Scope | Signing and provenance |
| --- | --- | --- |
| `desktop-candidates.yml` on main | Four native core targets, one immutable private source SHA, synthetic QA; unsigned engineering packages | No Release; seven-day retention. This first-release replacement uses explicit `verify_upgrade=false`, continuing baseline rebuilding without claiming cross-version upgrade acceptance. Future `verify_upgrade=true` requires reviewed, available immutable [upgrade baselines](ci/upgrade-baselines.json) and a strictly increasing version. |
| Separate `macos-signed-candidates.yml` | Signs/notarizes approved Mac binaries; does not compile | [Signing tuples](ci/macos-signing-baselines.json) identify exact successful platform jobs, main workflow origins, artifact IDs/digests and source. They must be reviewed into main before dispatch. Existing provenance, expiry, credentials cleanup, native QA and final-byte checks remain mandatory. |
| `reader-internal-025-builds` full-product producer | Independently pinned tooling/application source; bundled speech plus other products/targets | Protected signing environments; not the core first-release lane. |

Both sourceDF4 signed Mac runs completed successfully: [arm64 45841893369](https://github.com/lwtlab/reader/actions/runs/45841893369) and [Intel 45841936713](https://github.com/lwtlab/reader/actions/runs/45841936713). Their exact final DMG/ZIP and seven metadata files per target passed independent full privacy/resource checks. The complete actual 23-member Mach-O sets match their raw inputs; Developer ID signatures, timestamps, hardened runtime and app/DMG notarization tickets pass. Native ARM quarantine/Gatekeeper was independently checked locally; Intel local inspection on ARM is read-only cryptography/tickets, while actual Intel execution comes from Intel CI. Linux AppImage/DEB and unsigned Windows NSIS/Portable also passed their own full exact-byte checks. The acceptance snapshot now binds these final eight hashes and retains source851/source3f history. Known core material gaps are closed with original notices, honest publisher-declaration supplements and source-availability information, and sharp/libvips is absent from all eight payloads; this is distinct from publication authorization.

Manual installer/system-prompt acceptance is skipped by the maintainer for core 0.26.0, including replacement candidates: unperformed and not passed. [The acceptance snapshot](manifests/desktop-0.26.0-acceptance.json) binds exact source/hash sets; its evidence never certifies different bytes, and newly signed installers require their own binding. Publication and website deployment remain unauthorized. The website keeps desktop/store channels unset until actual publication; download URLs are bound after upload rather than required to exist beforehand. Private hosted CI is not expected to run for this preparation; local managed checks and public native CI remain separate evidence.

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
