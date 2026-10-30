# LWT Reader

Bug reports and feature requests for [LWT Reader](https://reader.cubbber.com/) mobile app.

Issues are created automatically from the app's **Report Bug** feature (Settings → Report a bug).


## Desktop candidate builds

[Desktop candidate packages](https://github.com/lwtlab/reader/actions/workflows/desktop-candidates.yml) is a maintainer-only manual workflow for macOS arm64/x64, Windows x64 and Linux x64. Supply a full commit SHA from the private source repository and select `all` or a single native target. The workflow uses a repository-scoped, read-only SSH deploy key in the `PRIVATE_SOURCE_SSH_KEY` Actions secret; it does not require a personal access token.

This repository contains build infrastructure only. Private source is checked out on ephemeral runners, built without signing, and tested using synthetic application data. Successful jobs upload candidate installers and SHA-256 manifests for seven days. No GitHub Release is published.

The upload gate includes actual installer lifecycle checks: Windows per-user NSIS installation, uninstall registration and shortcuts; Linux apt/dpkg installation and removal; and macOS read-only DMG mount, application copy and removal in a temporary directory. Each host checks same-version overwrite, retained library/notes/progress/settings, uninstall and reinstall. Windows and Linux use the disposable runner's initially absent default user profile, so uninstall data retention is tested at the real application path. Existing installations or profiles cause refusal. macOS always uses an isolated temporary profile. These engineering candidates do not certify cross-version upgrades, signing, notarization, SmartScreen or Gatekeeper behavior.

Candidate artifacts also include desktop update metadata, checked against the matching package names, sizes and SHA-512 digests. Unsigned candidates keep online installation disabled. Update transport checks use an isolated local feed and inert synthetic payloads; they do not certify signed upgrades. Future desktop feeds use a dedicated `desktop-stable` release tag and separate platform/architecture/profile channels, independent of the mobile app's latest release.

Windows portable.exe and Linux AppImage have separate direct-launch checks, including text/PDF parsing, persistent default data outside temporary extraction, reopen after moving the launcher, process cleanup and extraction cleanup. Linux reports whether normal FUSE launch or the explicit extract-and-run fallback was exercised.

`portable-checks.yml` reruns QA without rebuilding, using only the immutable artifacts explicitly approved in `ci/portable-baselines.json`. The workflow checks the original successful platform/upload gate, repository, workflow revision, artifact ID, archive digest and retention before download. Binary source revisions are recorded from the approved original dispatches; the separate QA source SHA is not a claim that the binary was rebuilt. It never republishes candidates or creates a Release. Baselines fail closed when expired and require a reviewed update to advance.

Build commands redirect detailed output to a temporary file, encrypted with the public key in `ci/build-logs-public.pem` before upload. Encrypted diagnostics expire after three days. The corresponding private key stays with the maintainer, outside GitHub. To inspect downloaded diagnostics locally:

```sh
node ci/decrypt-log.mjs reader-private-build.log.enc.json /secure/path/build-logs-private.pem /secure/path/build.log
```

Private checkout contents and raw build logs are not uploaded. Packaging removes source maps and the workflow audits the final application archive. Electron installers necessarily contain the JavaScript used to run the application; distributing binaries does not conceal that runtime code. Keep this workflow manually triggered and restrict repository write access, since workflow editors can change what the runner executes.
