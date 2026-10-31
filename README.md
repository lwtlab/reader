# LWT Reader

Bug reports and feature requests for [LWT Reader](https://reader.cubbber.com/) mobile app.

Issues are created automatically from the app's **Report Bug** feature (Settings → Report a bug).


## Desktop candidate builds

[Desktop candidate packages](https://github.com/lwtlab/reader/actions/workflows/desktop-candidates.yml) is a maintainer-only manual workflow for macOS arm64/x64, Windows x64 and Linux x64. Supply a full commit SHA from the private source repository and select `all` or a single native target. The workflow uses a repository-scoped, read-only SSH deploy key in the `PRIVATE_SOURCE_SSH_KEY` Actions secret; it does not require a personal access token.

This repository contains build infrastructure only. Private source is checked out on ephemeral runners, built without signing, and tested using synthetic application data. Successful jobs upload candidate installers and SHA-256 manifests for seven days. No GitHub Release is published.

The upload gate includes actual installer lifecycle checks: Windows per-user NSIS installation, uninstall registration and shortcuts; Linux apt/dpkg installation and removal; and macOS read-only DMG mount, application copy and removal in a temporary directory. Each host checks same-version overwrite, retained library/notes/progress/settings, uninstall and reinstall. Windows and Linux use the disposable runner's initially absent default user profile, so uninstall data retention is tested at the real application path. Existing installations or profiles cause refusal. macOS always uses an isolated temporary profile. The separate cross-version gate below checks an explicitly approved version pair. These engineering candidates do not certify signing, notarization, SmartScreen or Gatekeeper behavior.

Candidate artifacts also include desktop update metadata, checked against the matching package names, sizes and SHA-512 digests. Unsigned candidates keep online installation disabled. Update transport checks use an isolated local feed and inert synthetic payloads; they do not certify signed upgrades. Future desktop feeds use a dedicated `desktop-stable` release tag and separate platform/architecture/profile channels, independent of the mobile app's latest release.

Windows portable.exe and Linux AppImage have separate direct-launch checks, including text/PDF parsing, persistent default data outside temporary extraction, reopen after moving the launcher, process cleanup and extraction cleanup. Linux reports whether normal FUSE launch or the explicit extract-and-run fallback was exercised.

`portable-checks.yml` reruns QA without rebuilding, using only the immutable artifacts explicitly approved in `ci/portable-baselines.json`. The workflow checks the original successful platform/upload gate, repository, workflow revision, artifact ID, archive digest and retention before download. Binary source revisions are recorded from the approved original dispatches; the separate QA source SHA is not a claim that the binary was rebuilt. It never republishes candidates or creates a Release. Baselines fail closed when expired and require a reviewed update to advance.

Build commands redirect detailed output to a temporary file, encrypted with the public key in `ci/build-logs-public.pem` before upload. Encrypted diagnostics expire after three days. The corresponding private key stays with the maintainer, outside GitHub. To inspect downloaded diagnostics locally:

```sh
node ci/decrypt-log.mjs reader-private-build.log.enc.json /secure/path/build-logs-private.pem /secure/path/build.log
```

Private checkout contents and raw build logs are not uploaded. Packaging removes source maps and the workflow audits the final application archive. Electron installers necessarily contain the JavaScript used to run the application; distributing binaries does not conceal that runtime code. Keep this workflow manually triggered and restrict repository write access, since workflow editors can change what the runner executes.

## Cross-version candidate acceptance

`desktop-candidates.yml` now verifies the explicitly approved previous artifacts in `ci/upgrade-baselines.json`, downloads them by immutable artifact ID, and runs actual installer upgrades before uploading the next candidate. The approved previous version is now 0.1.6; the next private source must contain a strictly greater stable numeric app version (currently 0.1.7). Windows uses NSIS, Linux uses apt/dpkg, and macOS replaces the application copied from the DMG in an owned temporary directory. Synthetic text, PDF, notes, progress, settings, post-upgrade writes and reinstall access are checked. This is an unsigned engineering candidate check, not a signed auto-update or an assertion that database schema changed.

Approved artifacts expire with their original 7-day retention. Expired, changed or failed baselines stop the build; maintainers must explicitly review and update the baseline records when advancing the test pair. `verify_upgrade` defaults to true and fails closed. An explicitly dispatched `verify_upgrade=false` may rebuild an engineering baseline, but it does not assert cross-version acceptance; the run records that choice. Do not silently select latest, re-upload an old archive as a new build, or extend consent to user data. Private build/test output remains encrypted with the existing 3-day diagnostic retention. This workflow never publishes a Release.

## Core backend acceptance without rebuilding

`core-checks.yml` uses a separate full private QA source SHA and the immutable candidates explicitly approved in `ci/core-baselines.json`. It verifies the original successful platform/upload gate, repository, workflow revision, artifact ID, digest and retention before download. The all-platform target requires exactly macOS arm64/x64, Windows x64 and Linux x64; an absent baseline fails instead of dropping a platform.

QA installs the real core container on a disposable runner, then runs its packaged Electron Node runtime and standalone service with clean synthetic data and an explicitly empty engine root. Five native capability flags must be false; generated original WAV transcription must return 503, native Kokoro preview must explicitly reject, and neither may leave a queued transcription or a phantom library entry. Text/PDF parsing and article restart persistence continue after those errors. This is clean-configuration backend acceptance, not UI/audio success, WebGPU, offline, every persisted configuration, or Chromium sandbox acceptance. It does not compile the app, republish candidates or create a Release; only encrypted diagnostics are uploaded for three days.

## Saved speech configuration regression

The candidate pipeline seeds the approved previous installation with FluidAudio ASR, MLX runtime and FluidAudio VAD preferences, then checks that the next version retains the same settings while rejecting unavailable upload and microphone transcription with 503. Old-version seeding never starts ASR. After upgrade, old/new library data remain accessible and no phantom transcription tasks are created. The app must not reset stored choices to hide missing resources.

A separate pre-upload gate runs `smoke-desktop-saved-speech.mjs` against the actual new container. It tests four persisted ASR/runtime/VAD combinations dynamically and after service restart, with an isolated empty model root, no jobs/books created by failed requests, and text/PDF import/read/restart persistence. The local 0.1.1 macOS reproduction accepted a missing FluidAudio job with 200; this is a real runtime fix in the new 0.1.2 source, requiring new builds rather than rebranding old artifacts. No speech-success, UI, offline or signing claim is made.

## Native offline reading acceptance

`offline-checks.yml` reuses the four approved 0.1.2 artifacts in `ci/offline-baselines.json`, with the same immutable provenance and upload-gate checks. The QA source SHA is independent of the recorded binary source. No candidate is rebuilt or republished; only encrypted diagnostics are retained for three days.

Future `desktop-candidates.yml` builds run the same offline check before candidate upload. A private QA source without the required entry point fails; the gate is never silently skipped.

QA installs the actual NSIS/DEB/DMG container, then uses a fresh isolated profile for native offline cold start, text/PDF import and reading, notes/progress/settings, offline relaunch, network restoration and new writes. The candidate's own Electron Node runtime must connect to a positive external TCP control before restriction, reject the same connection while loopback remains usable under restriction, and connect again after restoration. A failed control fails the check.

Linux runs the worker and application tree in a new loopback-only network namespace. Windows temporarily blocks non-loopback IPv4/IPv6 outbound connections for every executable in the installed application directory; rules use a unique owned group and the original firewall profile states are restored. It never disables the host network or targets the Actions agent. Those system operations require an explicitly opted-in disposable runner.

macOS uses a process-tree Seatbelt network restriction. Because Chromium's own Seatbelt initialization conflicts with the outer sandbox, only the offline QA phase explicitly uses `--no-sandbox`; the restored-network phase uses normal launch arguments. This is a reading/persistence check, not Chromium sandbox acceptance or physical airplane-mode testing. The deprecated `sandbox-exec` mechanism is test tooling, not a product packaging change. No production launch parameters, user data, model downloads or online speech/AI success are involved.

## Configuration write failures

Candidate builds first validate native storage controls on a separate 128 MiB image (APFS on macOS, ext4 on Linux, NTFS VHD on Windows). The fill operation checks the filesystem device, capacity and owned marker before writing; it refuses the host filesystem. Windows/Linux system operations require the disposable-host opt-in. Images are detached after the test.

The packaged-service gate then checks actual configuration write permission denial and volume exhaustion through the real settings API. Failed requests must retain the exact previous configuration bytes, cleanup temporary files, succeed after permissions/space are restored, and preserve text/PDF across service restart. Data and SQLite remain on a separate temporary path: this is configuration-volume failure acceptance, not a full-system-disk, every storage adapter or UI error-message claim. The original 0.1.2 macOS package truncated a 2,329-byte config to zero after an ENOSPC response; the 0.1.3 source uses flushed temporary writes and replacement, requiring a new build.

Windows storage checks use explicit native PowerShell steps and a system Windows PowerShell module path for the ACL helpers. This avoids MSYS backup/restore privilege inheritance and cross-version module lookup; an encrypted token diagnostic records the native context. The preflight must still demonstrate actual write and create denial, readable original bytes, and successful writes after restoration before the long build starts.

## Library volume exhaustion

An additional pre-upload gate places SQLite, uploaded article JSON/media, instance configuration, cache and work paths on the same owned 128 MiB volume. It seeds original text, a generated PDF with an embedded image, notes, reading progress and preferences. Actual article, image publication and large SQLite note writes must fail while full; existing library/API media bytes and notes must remain intact. Installation and system temporary paths stay outside the volume. This is backend data-volume acceptance, not exhaustion of the system disk, Chromium profile or every application writer.

Cold SQLite open may require space even to read. QA records whether opening the full volume is available, frees the owned filler, and requires the same running service to recover without another restart. The original 0.1.3 macOS package retained a failed database-initialization promise and kept returning 500 after space returned. The 0.1.4 source evicts failed initialization attempts while sharing successful/in-flight connections. This runtime change requires new candidate builds; old artifacts are not relabeled.

The bounded fill controller drains fresh files using both synchronous and asynchronous writes at several sizes and with the exact image bytes produced by the packaged parser. Every probe must reach ENOSPC without making further file-byte progress. A single large file's ENOSPC, or a filesystem's reported free-space threshold, is insufficient on APFS. Before fault injection, the exact PDF and 64 MiB note payloads must succeed in a separate unconstrained temporary store. All owned fillers remain until recovery, within the existing volume/device/marker, 4,096-round and 160 MiB file-byte budgets.

`profile-storage-checks.yml` reruns the volume controls and packaged data-volume checks against immutable candidates explicitly approved in `ci/profile-storage-baselines.json`. QA source is independent of the binary source; no candidate is recompiled, relabeled or uploaded. A requested `all` requires all four approved targets and fails closed while any baseline is absent. Only encrypted diagnostics are uploaded for three days.

All four profile-storage baselines now pin the verified 0.1.4 candidates. Rechecks retain the original artifact IDs and expiry times; expired baselines require an explicit reviewed update.

## File read-access recovery

The 0.1.5 candidate pipeline checks native file read-denial controls before compiling, then runs `smoke-desktop-read-access.mjs` against the actual container before upload. QA-owned synthetic article indexes, parts, media, configuration and a closed SQLite database lose read access temporarily. Existing content must not become a successful missing/empty result. A configuration mutation while its original file is unreadable must fail without replacing any original bytes. Restored access must allow reads, new writes and restart persistence while retaining notes, progress and settings. Genuine absent article/part requests retain 404.

POSIX restores captured file modes; Windows uses native PowerShell, system modules and the current SID's ReadData deny ACL, restoring the original SDDL. The preflight requires an actual denied `readFile` and a writable parent directory. These checks cover selected ordinary files; directory traversal restrictions, damaged files, removed external volumes and physical-device/security-prompt acceptance remain outside this gate. Build output remains encrypted under the existing diagnostic retention policy.

The complete four-platform 0.1.5 candidate run [41175572596](https://github.com/lwtlab/reader/actions/runs/41175572596) passed all applicable gates, including actual 0.1.4-to-0.1.5 installer upgrades and the new read-access checks. Each host passed 281 tests in 35 files before building. Candidates retain their original seven-day engineering-artifact retention; this does not publish a Release or verify signing.

## Damaged JSON protection

The 0.1.6 pipeline adds `smoke-desktop-corruption.mjs` before candidate upload. It uses actual container binaries and original synthetic data to test damaged index, part, legacy single-file and configuration bytes: truncated/empty JSON, null, array/string/boolean roots and invalid UTF-8. The app must preserve damaged bytes, return explicit failures without quoting private content, retain original database state and resume after QA restores known complete files. Cold starts with a damaged index or configuration are included, followed by new writes and restart persistence. This is file decoding and read/modify/write protection, not automatic content reconstruction, full semantic validation or complete-profile backup.

The same pipeline also runs `smoke-desktop-formats.mjs` against the actual container: original TXT, Markdown, HTML and two-chapter EPUB uploads with Chinese/space filenames, parsed body checks, exact embedded-image bytes, notes/progress and service-restart persistence. The EPUB/PNG are generated with Node built-ins; no third-party books or external archive tools are used. This is API/storage acceptance, not visual rendering or interactive navigation acceptance.

The complete four-platform 0.1.6 candidate run [41188844805](https://github.com/lwtlab/reader/actions/runs/41188844805) passed on its first attempt. Each host passed 312 tests in 37 files, all 30 damaged-JSON cases, four file-format import/restart cases and the applicable existing lifecycle/upgrade/storage/offline gates. Actual installer upgrades used the pinned 0.1.5 originals. All four candidate manifests and 17 artifact files were downloaded and locally verified. These remain unsigned engineering artifacts with their original retention; no Release was published.

## macOS signed candidate staging

`macos-signed-candidates.yml` is a separate manual-only pipeline for the approved 0.1.7 Mac binaries in `ci/macos-signing-baselines.json`. It verifies immutable source artifacts, then signs, notarizes, staples and repackages on native arm64/Intel hosts. Application version and JavaScript archive stay unchanged; production updates remain disabled. A distinct report binds signing provenance and verified signatures/tickets to the final checksummed containers. The DMG blockmap/feed are regenerated after stapling.

The `macos-signing` environment is limited to main. Configure `MACOS_SIGNING_P12_BASE64` and `MACOS_SIGNING_P12_PASSWORD` with only the approved Developer ID identity; the three `MACOS_NOTARY_*` secrets are already configured. The maintainer deferred certificate export because the local keychain rejected non-interactive export. [Issue #6](https://github.com/lwtlab/reader/issues/6) contains the exact certificate identity, upload commands and acceptance checklist. Cloud signing has not run successfully and must not be presented as accepted. P12/password contents never belong in issues, chat or the repository.

Credentials are imported only after dependencies are installed, removed before packaged application QA, and cleaned on failure. Missing credentials, wrong identity, unaccepted notarization, invalid tickets or any native gate failure prevent candidate upload. The workflow retains seven-day candidate artifacts and three-day encrypted diagnostics; it never creates a Release. Real system-dialog and installation acceptance remain separately pending.

## Linux virtual display diagnostics

`linux-display-checks.yml` is a manual infrastructure-only probe: it starts owned Xvfb/Openbox sessions without private checkout, applications, signing material or package publication. It compares the existing server defaults with explicit `-noreset`; the minimized probe closes a short-lived X client immediately before starting Openbox. The two diagnostic runs (100 rounds and 30 rounds per mode) passed all 260 starts. Those isolated starts did not reproduce the installer-to-AppImage failure. The approved 0.1.6 AppImage passed standalone QA, then failed after actual install/overwrite/uninstall/reinstall on run [41199439006](https://github.com/lwtlab/reader/actions/runs/41199439006); the same original, QA source and sequence passed with only `-noreset` enabled on [41199769776](https://github.com/lwtlab/reader/actions/runs/41199769776). Linux CI now keeps the X server generation stable through short readiness-client disconnects. `portable-checks.yml` exposes an optional installer prelude and reset-policy control for this native regression; normal QA defaults to noreset. Candidate/portable/offline workflows now retain Xvfb server errors through `ci/run-xvfb.sh`: an owned temporary log avoids reopening Node stderr sockets, preserves the QA exit status, and forwards diagnostics to the existing encrypted private-step log before cleanup.
