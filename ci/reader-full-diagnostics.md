# Reader full diagnostic key recovery

The Reader full worker uses `reader-full-logs-public.pem` only. Its RSA-3072 SPKI DER
SHA-256 is `60638e94630f09a4877cf18801870c75894d1da5d409b37983064fd8e0740655`.
The legacy shared `build-logs-public.pem` and all other product/profile recipients are
unchanged. The full workflow, 33 tasks, timeout, diagnostic allowlist, encryption
format and seven-day Actions retention are unchanged.

The matching PKCS#8 private key was generated directly into the operator's persistent
`${XDG_DATA_HOME:-$HOME/.local/share}/lwt-reader-ci/diagnostics-keys/` directory,
with mode 0700 on the directory and mode 0600 on key/index files. It is named
`<SPKI-DER-SHA256>.pem`. `active-reader-full.json` records the recipient fingerprint
and key filename. The private key was reloaded from that location for an actual
RSA-OAEP-SHA256 round trip before publishing this public recipient. Private key bytes
are never stored in Git, PR bodies, CI secrets, Actions artifacts, or this worktree.

A retained local key is not an independently tested backup. Before moving or removing
this host, export the key using the owner's protected credential backup process and
prove recovery by reloading that copy and decrypting a synthetic envelope. Do not
assume a public PEM, GitHub secret listing, or an ephemeral agent session can recover
a private key. This change cannot decrypt historical envelopes for the old recipient.

For an exact approved run/attempt, verify artifact ownership, workflow pin and ZIP
SHA-256 before opening `diagnostics.enc.json`. Use `ci/decrypt-log.mjs` from that
reviewed executor commit with the retained key and a new private output file:

```sh
node ci/decrypt-log.mjs diagnostics.enc.json '<persistent-key-path>' diagnostics.tar.gz
```

The command creates the output with mode 0600 and refuses an existing path. Keep the
containing directory private. Inspect the archive member list before extracting any
allowlisted task log. Public discussion may include task IDs, durations and reviewed
failure categories; raw stdout, private paths, source snippets and fixture content
remain local. Changing recipients needs a reviewed immutable workflow pin, a real
remote encryption/decryption qualification, and coordinated ref/config/discovery
updates. Do not mark old failures fixed just because a new run passes.
