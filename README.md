# LWT Reader

Bug reports and feature requests for [LWT Reader](https://reader.cubbber.com/) mobile app.

Issues are created automatically from the app's **Report Bug** feature (Settings → Report a bug).


## Desktop candidate builds

[Desktop candidate packages](https://github.com/lwtlab/reader/actions/workflows/desktop-candidates.yml) is a maintainer-only manual workflow for macOS arm64/x64, Windows x64 and Linux x64. Supply a full commit SHA from the private source repository and select `all` or a single native target. The workflow uses a repository-scoped, read-only SSH deploy key in the `PRIVATE_SOURCE_SSH_KEY` Actions secret; it does not require a personal access token.

This repository contains build infrastructure only. Private source is checked out on ephemeral runners, built without signing, and tested using isolated application data. Successful jobs upload candidate installers and SHA-256 manifests for seven days. These are engineering candidates, without release signing, notarization or an installation/upgrade acceptance claim. No GitHub Release is published.

Build commands redirect detailed output to a temporary file, encrypted with the public key in `ci/build-logs-public.pem` before upload. Encrypted diagnostics expire after three days. The corresponding private key stays with the maintainer, outside GitHub. To inspect downloaded diagnostics locally:

```sh
node ci/decrypt-log.mjs reader-private-build.log.enc.json /secure/path/build-logs-private.pem /secure/path/build.log
```

Private checkout contents and raw build logs are not uploaded. Packaging removes source maps and the workflow audits the final application archive. Electron installers necessarily contain the JavaScript used to run the application; distributing binaries does not conceal that runtime code. Keep this workflow manually triggered and restrict repository write access, since workflow editors can change what the runner executes.
