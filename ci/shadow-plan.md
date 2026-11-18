# Optional shared shadow-plan qualification

The existing `reader-private-verify.yml` accepts `scope=shadow-plan` on the independently reviewed
`ci/catalog-cpu-20261112` ref. Full/CPU dispatch, polling, contexts, caches, task contracts and
required-check policy remain unchanged. Shadow resolve performs the existing trusted PR/main and
immutable merge-parent checks, emits the exact binding, and returns before either pending-status write.

Dispatch metadata only after pushing reviewed private source and independently reviewing this public ref:

```sh
gh workflow run reader-private-verify.yml --repo lwtlab/reader --ref ci/catalog-cpu-20261112 \
  -f source_ref=<exact-private-head> -f pr_number=<trusted-open-PR> \
  -f workflow_sha=<exact-public-workflow-SHA> -f scope=shadow-plan
```

The fresh Linux job uses Node 24.22.0 and a full private checkout without persisted credentials or
submodule initialization. It verifies independently pinned private implementation hashes, runs the
planner's generated-Git controls, then computes the actual PR plan using the same local Git reader
and selector. Raw two-sided modes, delete/rename/copy paths, gitlinks in product directories, root
configuration and missing/truncated metadata are covered. Unknown/missing inputs select both products.
Generated Git objects are engineering controls; they are not user evidence or product source candidates.
Their four-class PASS does not qualify four real product PRs or their full execution gates.

The public collector pins the catalog and implementation, checks the full binding, clean stable source,
complete dependency closure, ordered membership, plan/change digests, NOT_RUN statuses and real step
conclusions. `require` recomputes the receipt from the original bytes before requiring PASS. It never
executes private task commands from the report. Invalid, modified, unbound or incomplete reports cannot pass.

`reader-shadow-plan-result-<run>-<attempt>` contains bounded identity/policy/digests, selected products,
generated-control results and allowlisted IDs only. Every planned task, all 33 mandatory Reader tasks,
release gates and native/GUI/model/install/audio acceptance remain NOT_RUN. A planning PASS never
satisfies `reader-public/full`, `reader-public/llama-cpu` or a release gate.

`reader-shadow-plan-encrypted-...` retains exact private plan bytes and generated-control logs for seven
days. Never upload plaintext plans or raw paths/commands. Independently check ZIP digests, authenticated
decryption, original summary digest and recomputed public result before qualifying an exact run.

No product selection, default verification pin/gitlink update, PR merge, application Release or website
deployment is enabled. Required-check enforcement remains subject to the private repository's plan/API.
