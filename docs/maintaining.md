# Maintaining public Reader delivery

This repository owns public release assets, delivery workflows, the website and user tutorials.
Application implementation stays in private `lwtlab/lwt-core`, which pins this repository as
`public/reader`. It is also usable as an ordinary independent clone.

## Repository layout

- `.github/workflows/` and `ci/`: manual private-source builds/signing and public infrastructure.
- `scripts/publish-release.mjs`: product-scoped release identity, provenance, upload and publication.
- `manifests/channels.json`: reviewed public download links, explicit versions, hashes and sizes.
- `site/`: independently installed Astro static website; guides are Markdown under `src/pages/guides`.

Commit source and metadata here; upload installers and extension ZIPs as Release assets. No private
Git objects, private app source, user books, diagnostic plaintext or credentials belong in this tree.
License/permission for any new content or images must be established before committing it publicly.

## Compatible release identities

| Product | Public tag | Repository Latest |
| --- | --- | --- |
| Android/mobile | `v<VERSION>` | Yes, only after all assets have uploaded |
| Desktop | `desktop/v<VERSION>` | No |
| Browser extension | `extension/v<VERSION>` | No |

Android currently reads `/releases/latest`; the server proxy does too, and reconstructs historical
APK URLs from `v<VERSION>` and `lwt-reader-<VERSION>.apk`. Preserve those paths and all existing
releases. Namespacing alone does not isolate Latest: every non-mobile publisher must explicitly
avoid Latest. A future per-product update protocol needs coordinated server/client rollout and old
client compatibility. The existing desktop `desktop-stable` feed is separate from versioned releases;
this work does not modify it or enable production updates.

Before a real release, complete the product's existing verification, signing and acceptance gates,
push the immutable private source commit, and commit/push reviewed public tooling. Hashes produced
by this publisher do not certify signatures, App Store review or native/manual acceptance.

From any working directory, call the public checkout's publisher with absolute inputs:

```sh
node /path/to/public/reader/scripts/publish-release.mjs \
  --product extension --version 0.4.0 --source-sha '<full private source SHA>' \
  --notes /path/to/notes.md --asset /path/to/reader-clipper-v0.4.0.zip
```

The default is plan-only: it hashes local files and prints metadata without GitHub writes. Replace
the example SHA/version/paths; review the plan, then add `--publish` only under release authorization.
For mobile use `--product mobile` with the matching APK; desktop uses `--product desktop` and one or
more verified installers. Repeat `--asset` for additional payloads, signing reports or checksums.

Publication targets `lwtlab/reader` explicitly and verifies that the current public HEAD exists there.
Tags point at that **public commit**, not the private app SHA. `reader-release.json` records both
repositories/commits and the hashes/sizes of the supplied assets. A new draft receives all assets
before the final publish command; a failed upload prevents publication. Inspect any remaining draft
and resolve it explicitly before retrying; the tool never overwrites a previous release.

Do not run `git push --mirror` from the private repository or push private tags/commits into this one.
GitHub's generated Source code ZIP is the public repository snapshot, not application-source proof.
Dispatch, build, signing and QA reports retain their own provenance; attach them where required.

After publication, review and update `manifests/channels.json` and the corresponding download-page
content in a public PR, using the published asset's actual URL, version, size and SHA-256. The site
does not fetch repository Latest or infer product availability from tag sort order.

## Website and tutorials

Use Node 24 independently of the application's Node/runtime requirements:

```sh
npm --prefix site ci
npm --prefix site run dev
npm --prefix site run verify
SITE_BASE=/ npm --prefix site run verify
node --test ci/*.test.mjs scripts/*.test.mjs
```

The default dev URL is `http://127.0.0.1:4321/reader/`. `SITE_BASE` defaults to `/reader/` for the
GitHub project site; set it to `/` for a custom hostname. The site-local `.npmrc` keeps optional
integration/storage-driver peers out of this static site's independent dependency installation.
`SITE_URL` is an HTTPS origin with no path,
defaulting to `https://lwtlab.github.io`. Local links use the configured base and the built-site check
verifies the landing page, downloads, guide index and guides without private application access.

`public-ci.yml` runs on public PRs and main, installs only site dependencies and tests both path
configurations. It does not check out private source or receive signing credentials. Keep contributor
code on ordinary `pull_request` checks, not privileged `pull_request_target` execution.

Deployment is deliberately separate. After the site is reviewed and activation is authorized:

1. Configure GitHub Pages to deploy through Actions and protect the `github-pages` environment.
2. Select the public hostname; keep the existing `reader.cubbber.com` application/API host intact.
3. Set repository variables `READER_SITE_URL`, `READER_SITE_BASE` and `READER_SITE_DEPLOY_ENABLED=true`.
4. Dispatch `site-deploy.yml` from main with `confirm=true`.

The deploy workflow is skipped unless main, explicit confirmation and the activation variable all
match. No DNS, Pages activation, repository variable or production update switch is changed by this
code. A website deployment needs only Pages/OIDC permissions, not the private deploy key or signing
Secrets. Protect `.github/workflows/**`, `ci/**` and `scripts/publish-release*` with reviewed ownership
and branch rules before granting broad contributor write access.

## Parent and child changes

Create a branch in the child after initializing the pinned SHA. Push and open the public PR first,
then update the parent's gitlink and link both PRs. A parent PR cannot merge or review the public
content by itself. If the child PR is squash/rebase merged, review/check the merged SHA and advance
the parent pointer accordingly. Site-only editorial work can proceed independently.

Do not add the private repository back as a submodule here. Public build workflows receive an
explicit private `source_ref`; it is independent of the parent's gitlink. Preserve both SHAs in
execution records. Gitlink rollback affects source checkout only, not Releases, Secrets or a deployed
site. Existing desktop workflow usage remains documented in the private source's CI handbook.
