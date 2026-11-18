# Selected Reader/Hear source verification

This is an explicit, reviewed `workflow_dispatch` scope in
`reader-private-verify.yml`. It is not enabled by the scheduled dispatcher.
The default local managed push still runs all 14 quick tasks; the existing
`reader-public/full` protocol still requires all 33 Reader tasks. Neither its
policy pin nor its reporter is changed here.

`selected-examples.json` freezes the implementation PR and four real change PRs.
Each entry binds an exact head, base branch, base SHA and raw Git change digest.
The resolver verifies the live trusted PR and the actual two-parent test merge.
An advanced base, changed head, closed PR or unready merge fails resolution.
Planner/executor bytes are independently pinned in `selected-implementation.json`.

| Source changes | Reader lane | Shared CPU lane | Hear lane | Total |
| --- | --- | --- | --- | --- |
| Reader only | Full 33 | Core 2 + CPU 9 | Skipped | 44 |
| Hear only | Mandatory quick 14 | CPU 9 | Native/GUI 7, including core 2 | 30 |
| Shared core or unknown | Full 33 | CPU 9 | Native/GUI 7, including core 2 | 49 |

The source repository's single Git change parser/planner owns path selection.
It handles both rename sides, deletions, gitlinks and root/unknown inputs.
Missing or malformed metadata conservatively selects both products. There is
one execution owner per selected task and complete dependency closure.
The public validator checks the resulting contract without maintaining another
path classifier. Unselected and unexecuted tasks remain `NOT_RUN`.

The three execution lanes use separate runners, checkouts, processes and data.
Reader uses Linux, CPU compilation uses a separate Linux runner, and Hear uses
macOS with an independently pinned Hear adapter. The quick profile
installs Chromium and Chrome required by the unchanged Reader preflight. The full
profile also installs Firefox/WebKit and produces the legacy full receipt. A quick result
cannot generate a Reader full success. Core initialization records a bounded
transition to the two pinned clean prerequisites; it cannot permit source edits.

Dispatch only the manifest's case/head/PR with the exact public workflow SHA,
`scope=selected-source`, `example=<manifest id>`, `selection_probe=false`.
The branch must be explicitly allowed by the `reader-verification` environment.
Do not broaden its deployment branch policy or enable selection by moving an
unreviewed default workflow pin.

For an initial focused diagnostic, `selection_probe=true` supports Reader-only
core/CPU execution. It skips the expensive Reader full lane, writes a separately
named `NOT_QUALIFIED` probe artifact, and never writes a private status or selected
qualification receipt. A successful probe does not satisfy a gate. Run the complete
selected scope separately after fixes and source/workflow freeze.

`reader-hear-public/selected` is a separate source verification context. The
privileged reporter has no private checkout. It validates the actual public run,
attempt, workflow, live private refs and latest pending status; authenticates each
small receipt ZIP; checks actual job conclusions; and independently reconstructs
complete coverage from original component bytes. It compares that result with the
published final receipt before writing success. An older run cannot overwrite a
newer pending/result. Missing, cancelled, failed or corrupt evidence cannot pass.

This reports a status; it does not configure branch protection. The private
repository's required-check configuration was previously rejected with HTTP 403
under its current GitHub plan. Until that service constraint is resolved and the
new policy is separately activated, operators must review exact receipts and keep
the existing required-check instructions. Do not describe the new context as
enforced merely because a success status exists.

Preparation and graph durations remain separate. The existing frozen Mobile
registry cache is reused; no private checkout, build output or model is cached.
Reader full progress exposes only allowlisted task IDs/status/durations. CPU and
Hear retain their bounded progress contracts. Progress is informational and cannot
replace the final source-bound receipt. Raw commands, paths, source, test output
and diagnostic summaries are retained only in authenticated encrypted artifacts.
Small receipts and encrypted diagnostics expire after seven days; expired bytes
require a fresh, separately identified run.

This scope verifies source execution and selected native compilation/scripted GUI.
It does not establish file-model inference, signed/notarized installation, upgrade,
uninstall, model recovery, system audio or physical-device acceptance. Those remain
separate source-bound #270/#271 results.
