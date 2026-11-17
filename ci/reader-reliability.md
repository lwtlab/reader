# Private Reader reliability on public runners

Application source stays in `lwtlab/lwt-core`. This executor extends the registered
`reader-private-verify.yml` workflow without changing the full 33-task or CPU
contracts. It accepts only a current main SHA or a trusted same-repository PR head;
PR execution uses the verified immutable merge commit and its two exact parents.

| Scope | Independent status | Runtime limit |
| --- | --- | --- |
| `sync-journey` | `reader-public/sync-journey` | 25 minutes |
| `large-library` | `reader-public/large-library` | 60 minutes |
| `playback-soak` | `reader-public/playback-soak` | 180 minutes |

The source checkout fetches complete history for archived-version compatibility.
Commands are a fixed reviewed catalog; dispatch cannot supply shell commands,
paths, timeout overrides, soak duration or playback speed. The soak always
requires 7,200 active seconds at normal speed. Missing prerequisites fail the job.

Control and reporting run in `reader-verification`; the test job has no personal
status/publishing token or signing identity. Private source is acquired with the
existing read-only checkout key and credentials are not persisted. All test output
is captured. Only the closed `verification.json` and encrypted diagnostics are
uploaded, retained for seven days. Diagnostics include the owned command log and
explicit synthetic result directories, not the checkout, environment or libraries.
Links and oversized diagnostics are rejected. No private source cache is added.

Receipts bind the profile contract, head/base/tested/workflow, run and attempt,
fresh task outcomes and clean unchanged source. Reporting checks the real Actions
job, exact artifact digest, current source and newest pending twice. A cancelled,
missing, invalid or superseded run cannot report success. Each scope has its own
context; one successful profile does not satisfy another.

## Qualification and activation

First dispatch the exact reviewed executor SHA from its isolated qualification
branch, with that branch explicitly allowed by the environment. Run the public
infrastructure suite (`node --test ci/*.test.mjs scripts/*.test.mjs`) before pushing.
Then qualify real source runs and verify the private status target and receipt.
Keep original failed/cancelled runs separate; never transfer a result to a new SHA.

The qualification branch is `ci/reader-reliability-20261117`. Existing automatic
full discovery does not discover the new scopes. PR/nightly activation and stopping
the old private workflow require a separate verified rollout. Until then the
private workflow remains the automatic fallback. Neither a draft PR nor a YAML
change proves activation. Required-check configuration is independent of execution
and may be unavailable under the private repository's current plan.

The change does not publish releases, deploy the website, alter signing settings,
change application behavior or claim Hear/shared-core/native-device coverage.

## Automatic discovery prepared for rollout

The `discover-reliability` job uses the existing half-hour public schedule after
its reviewed workflow is delivered to public main. It defaults off, controlled by
`READER_RELIABILITY_AUTOMATIC` and exact `READER_RELIABILITY_WORKFLOW_SHA`.
It dispatches the dedicated executor ref, checks trusted PR merge parents, and
selects sync only for sources that actually contain the command. The current main
also receives the large-library profile once per UTC day. Failure results are not
retried automatically for the same source/day; a new source or day is a new input.
Terminated runs with orphaned pending status are marked error, never success.
Soak remains manual. Metadata/permission failures do not synthesize a green check.

Activation requires real scope qualification, a reviewed public-main workflow
rollout and independently verified private status targets. Merely setting a flag
cannot install a scheduled workflow on a branch. Keep the private fallback until
all those conditions are met; enable only the corresponding migration flag then.
