# Explicit selection for trusted private pull requests

`scope=selected-pr` accepts trusted same-repository PRs whose head is not in the
historical five-example manifest. It uses the unchanged independently pinned
private planner, task catalog and executors. Historical `selected-source` runs
retain their original workflow and example bindings; their acceptance does not
qualify this new entry.

Dispatch the public branch recorded in `selected-pull-policy.json`, with explicit
`workflow_sha` equal to the executing public commit SHA, an exact private
`source_ref`, a positive `pr_number`, and `selection_base` equal to
the current allowed base branch's complete SHA. A head/base move, closed or fork
PR, untrusted association, unknown mergeability, or nonmatching ordered merge
parents fails resolution. `pr_number=0` and diagnostic probes are unsupported.
The reviewed QA baseline branch is allowed only to establish four actual change
classes without altering production source. Main is the production base.

Neither `example` nor any dispatch parameter determines products. The fixed
private implementation reads actual raw Git changes, including renames,
deletions and gitlinks; unknown or incomplete changes select both products.
Expected membership and dependency closure are reconstructed from the pinned
catalog. All14 mandatory gates remain unconditional. Reader-only executes44
tasks, Hear-only30, shared-core/unknown49. Reader quick cannot produce a legacy
33-task success; unselected tasks and release gates stay `NOT_RUN`.

The same resolver is used at dispatch and twice in the privileged final reporter.
The reporter has no private checkout; it authenticates run/attempt/workflow,
actual job outcomes, receipt ZIP digests and original component bytes, rebuilds
coverage, and checks latest pending ownership before posting the separate
`reader-hear-public/selected` context. A stale run cannot overwrite a newer one.
Raw source paths, commands and logs remain in authenticated encrypted artifacts.

Only explicitly permitted environment branches may consume credentials. Add the
exact reviewed branch after review; do not widen wildcard or default policies.
The default scheduled dispatcher, local14/full33 policy pins and server required
checks remain separate. A success status does not configure required checks; the
private repository's previously observed plan HTTP403 remains unresolved.

Qualification of the new entry requires fresh real Reader-only, Hear-only,
shared-core and unknown PR executions with each exact input and workflow SHA.
Old cases, generated unit controls and partial probes cannot substitute for those
executions. Automatic selection is not enabled by this implementation. Native
GPU model inference, signed installation, model recovery and physical audio
continue to have independent #270/#271 acceptance.
