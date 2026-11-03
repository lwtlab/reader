# Reader public repository

This repository owns public delivery infrastructure, release assets, the website and user guides.
Application source remains in the private `lwtlab/lwt-core` repository.

- Never add private application source, user libraries, diagnostic plaintext or credentials here.
- Website pull requests build without private checkout or signing credentials. Keep private build
  workflows manual; do not introduce `pull_request_target` execution of contributor code.
- Preserve Android `v<VERSION>` releases and their APK filenames. Other products must never become
  the repository's Latest release. Use `scripts/publish-release.mjs` for new public releases.
- Public release tags target public commits. Record private source SHAs in release metadata, never
  push private Git objects into this repository.
- Site deployment is independently gated; a code push is not permission to enable Pages or change DNS.
- Run `node --test ci/*.test.mjs scripts/*.test.mjs`. For site changes use Node 24, then
  `npm --prefix site ci` and `npm --prefix site run verify`.

When used as a submodule, push this repository's commit before updating the parent's gitlink.
Keep the parent and child PRs linked. Gitlink rollback does not roll back published assets or a site.
