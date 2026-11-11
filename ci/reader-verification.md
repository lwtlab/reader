# Private Reader verification on public runners

`reader-private-verify.yml` runs the private repository's unchanged 33-task full
graph on a standard public Ubuntu runner. It does not publish applications.

The controller accepts only current private main or an open same-repository PR
from an OWNER, MEMBER or COLLABORATOR targeting main. A PR execution checks the
immutable GitHub merge commit and verifies its parents against the exact base and
head. The base SHA comes from `git/ref/heads/main`, both during resolution and
completion checks. GitHub's PR `base.sha` can remain at an older snapshot after
main advances even though the generated merge commit already has the new parent;
that snapshot is not authoritative. Merge parent equality remains mandatory.
Dispatch must include the exact public workflow commit. No branch name is
accepted as source, and no untrusted public PR event runs this workflow.
Transient GET failures and incomplete JSON responses use at most three attempts.
Generated merge metadata may also be re-read three times with bounded backoff;
the selected head never changes. Writes and authorization failures are not
automatically retried. Public errors expose only bounded categories, never API
response content, credentials or assertion values.

`resolve`, scheduled `poll`, and `report` use the personal credential
`READER_VERIFICATION_TOKEN` in the separate `reader-verification` environment,
restricted to public main and `reader-public-full-verification`. The credential needs private PR/commit reads, commit
status writes and public workflow dispatch/artifact reads. It is deliberately
absent from the full test job. The existing read-only source SSH key is used with
`persist-credentials: false`. Signing and application publishing are not involved.
The existing personal credential may have broader access than these operations;
job isolation does not make that credential narrowly scoped.

Public output consists of fixed stage messages and `verification.json`, whose
closed schema contains commit/run bindings, summary digest and 33 bounded task
results. Private command output is captured by `private-step.mjs`. Complete
synthetic execution logs, summary and browser artifacts are archived from explicit
allowlisted locations, encrypted with the existing maintainer public key, and
retained for seven days. Symlinks, arbitrary checkout files and credentials are
not collected. Use the existing `ci/decrypt-log.mjs` with the local private key to
decrypt the encrypted archive, then inspect it locally. This is engineering CI
metadata, not product feedback, user Evidence Bundles or Regression Fixtures.

The reporting job independently verifies repository, workflow identity, workflow
commit, run, attempt, job conclusion, artifact digest and exact receipt schema.
It rechecks the current PR head/base and latest pending status before writing
`reader-public/full`. An older result cannot replace a newer run. Missing,
cancelled, failed or invalid evidence cannot report success. The scheduled poller
reconciles completed runs that left a pending status as error; matching failures
are not automatically retried. A new source/base/workflow is a new input.

During rollout the repository variable `READER_VERIFICATION_AUTOMATIC` is absent
or `false`. After an actual full PASS it can be set to exactly `true` for a
half-hourly scan of trusted private PRs and main, without changing the reviewed
workflow pin. `READER_VERIFICATION_WORKFLOW_SHA` pins the dedicated verification
branch so unrelated public website commits do not invalidate private results.
A schedule runs from public main and dispatches that exact dedicated branch; it needs no private hosted runner or permanently running local
agent. Manual dispatch remains available without waiting for the next scan.
Public schedules may be delayed; if GitHub disables inactive schedules, re-enable
the workflow. No schedule guarantees immediate execution after each push.

The private repository's `scripts/verify-public.mjs --pr <number>` checks clean,
pushed source and the reviewed workflow pin, then sends metadata only. It never
uploads source archives, binaries or browser artifacts through the local host.
Do not use a private caller with `workflow_call`: reusable workflow billing follows
the caller and would preserve the private account's quota problem.

Required checks must explicitly select the new `reader-public/full` context rather
than impersonating the old `test`/`verify` Actions checks. Keep managed local
pre-push governance. A full PASS covers the task graph, not physical-device,
signed-package or native installation acceptance.


Informational task progress is read only from the source verifier's bounded
`progress.jsonl`, restricted to this public repository's fixed 33 task IDs,
statuses and durations. The wrapper emits at most a RUNNING and terminal event
per task while retaining private stdout/stderr in the encrypted diagnostic log.
The separate `progress.json` binds head/base/tested/workflow/run/attempt and
records runner preparation separately from the graph wrapper. It is never a
verification receipt; missing, malformed or incomplete progress cannot produce
a required-check success. The final 33-task receipt/reporting contract is unchanged.

Only Mobile public registry download content may be cached. Before restoring a
cache, the public workflow independently validates every locked dependency's
public HTTPS origin and SHA-512 integrity. The cache lives in a dedicated runner
temporary directory and includes only `_cacache`, excluding npm logs. Reader's
pnpm store is deliberately excluded because it includes private local `file:`
packages. Frozen installation and all assertions still run after a cache hit.
The checked-in source selection policy remains disabled, and task execution
remains serial pending separate review and public qualification.

## Native CPU gate

The same registered workflow now also runs the original private `reader-llama`
CPU gate in an independent Ubuntu job. The default `scope: full` preserves all
33 Reader tasks and runs CPU work in parallel on a separate runner. Its separate
`reader-public/llama-cpu` status requires all nine original stages: exact-gitlink
CPU compilation, parity controls, aligner-overlay controls, speech-release
controls, GGUF tooling, ASR conversion, model-distribution controls, forced-aligner
conversion and CLI help. This is compilation and source/format conformance; it
is not inference with actual model weights, hardware acceptance or an application
release.

For focused repairs, dispatch the existing `reader-private-verify.yml` with the
same immutable source/PR/workflow inputs plus `scope: llama-cpu`. This mode never
creates or updates `reader-public/full`. The selected scope is bound into the
CPU receipt and status fingerprint. The default remains `full` for the existing
scheduled discoverer, so its old three-input dispatch remains compatible.

The CPU worker has the existing read-only source key, never the personal status
credential. It initializes only the approved public llama.cpp gitlink over HTTPS;
it does not recursively initialize private submodules. GGUF tooling uses an
isolated Python environment. Build output, command logs and the generated
binary/library/build-identity bundle are captured only in an encrypted artifact,
with seven-day retention. No private compiler-object cache or plaintext native
bundle is published. The public CPU receipt has only fixed task IDs, bounded
statuses/durations, exact source/workflow/run/attempt/scope bindings and opaque
build/diagnostic digests. Library links must resolve inside the generated bin
directory; source and credentials are not archived.

The independent CPU reporter verifies the actual job conclusion as well as the
receipt digest/schema and current source identity. Failed setup, compilation,
controls, encryption or artifact upload cannot produce a successful status.
The original full receipt still requires exactly 33 fresh PASS tasks; CPU evidence
cannot substitute for it, and a full receipt cannot substitute for CPU evidence.

Retire the private automatic `reader-llama` workflow only after a focused public
CPU run is qualified. Then independently qualify the final private source with
both full 33 and CPU 9 before restoring automatic discovery. Historical private
billing failures remain failed/not-started under their own identities. Do not use
`workflow_call` from a private caller: its billing would still follow that caller.
If branch protection is available, required-check rollout must explicitly use
both new contexts after qualification rather than impersonating `build-cpu`.
A commit status alone does not enable enforcement; private repository plan or
administrative restrictions must be recorded separately.
