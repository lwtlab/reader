# Optional qualification of four real source changes

Use `scope=change-example` on `ci/change-examples-v2-20261112`. The checked-in manifest fixes
four independently reviewed documentation commits, their private draft PRs, one frozen parent
branch/head, each raw Git diff digest and the public Hear adapter commit. These are useful
product/core/operator documents in real source commits, not generated parser fixtures.
Generated Git controls remain a separate prerequisite and never substitute for these runs.

Dispatch each manifest entry separately using the existing registered workflow:

```sh
gh workflow run reader-private-verify.yml --repo lwtlab/reader --ref ci/change-examples-v2-20261112 \
  -f scope=change-example -f example=<reader-only|hear-only|shared-core|unknown> \
  -f source_ref=<manifest-head> -f pr_number=<manifest-private-PR> \
  -f workflow_sha=<exact-reviewed-public-SHA>
```

The resolver accepts only the manifest's same-repository trusted open nested PR, exact head,
current frozen base branch reference and actual generated merge parents. It does not accept
arbitrary historical commits or contributor code. The four PRs target the frozen shared-source
branch; these results qualify their own tested merges, not the parent PR's merge with main.

The plan job pins the current private implementation before the first CLI, runs the generated
Git controls, computes the actual base/head plan with the same local Git reader/selector and
checks the reviewed diff digest. No raw private paths or commands appear in its public receipt.

Qualification deliberately runs a safe superset while selection remains shadow-only:

| Example | Products selected | Selected tasks | Actual executed tasks |
| --- | --- | ---: | ---: |
| Reader-only | Reader | 44 | 49 |
| Hear-only | Hear plus mandatory Reader quick gates | 30 | 49 |
| Shared core | Reader and Hear | 49 | 49 |
| Unknown path | Reader and Hear | 49 | 49 |

Reader's complete 33-task graph runs unchanged on Ubuntu. The shared catalog CPU job runs
all nine stages/eleven actual commands on a separate Ubuntu runner. Hear's seven-task
native/scripted-GUI scope runs on macOS through the independently pinned public adapter.
Checkouts, dependencies, artifacts, databases, ports and process ownership are independent.
No writable application profile or build directory is shared across jobs. Only the existing
reviewed public-registry Mobile download cache is used; no native/result cache is restored.
Preparation, graph and whole-job durations remain separate measurements.

Reader full adds a scope-only companion that binds run/attempt, exact old receipt bytes, the
original summary and complete catalog contract. Its freshness starts at the current job
preparation marker, and final require recomputes it from the original report. The default
33-task receipt schema is unchanged.

Each execution job recomputes and requires its original receipt against live source/output
before publishing. The aggregate requires successful actual jobs and closed, exact-source,
workflow/run/attempt receipts. It verifies full33, native7 and CPU9 membership, policy/contracts,
CPU companion/legacy receipt digests and the selected plan's complete execution coverage.
Its PASS has 49 actual tasks; a failed/missing/unbound input cannot supply qualification.
Original per-job failures/partial execution stay in their own receipts and authenticated logs.

Attempt-specific artifacts require rerunning all qualification jobs for a new attempt.

Distinct `reader-change-*` artifacts cannot satisfy the old full/CPU reporters. The workflow
never writes either default status context; the old resolve/full/CPU/report jobs are skipped
only for this explicit optional scope. Polling, normal full33/CPU dispatch, mandatory local14,
operator pins/gitlinks and required-check policy are unchanged. Do not merge the parent
public branch or deploy the site as part of this qualification.

Bounded receipts and informational progress may be public; original plans/logs/native bytes
remain encrypted with the existing Reader diagnostic public key and expire after seven days.
Independently verify all ZIP digests, authenticated diagnostics, source/merge/pin identities,
actual native/build hashes and recomputed receipts before qualifying an exact run. Expiry
requires a new separately identified run. Real models, signing/install/upgrade/uninstall and
system/physical audio remain NOT_RUN. Actual product selection rollout needs separate review.

Before the first dispatch, allow only `ci/change-examples-v2-20261112` as a new branch policy
in the existing public `reader-verification` environment. Review that exact narrow configuration
with this workflow; do not change secrets, reviewers, existing branch policies or private required checks.

The exact new environment branch policy (after code review and a successful public tooling run) is:

```sh
gh api repos/lwtlab/reader/environments/reader-verification/deployment-branch-policies \
  --method POST -f name=ci/change-examples-v2-20261112 -f type=branch
```

## Frozen qualification cohorts

The current manifest uses base `ec325430d64713cbe7d80800a7938ceadbdd279b` on
`qa/change-examples-base-20261112`. It adds two independently reviewed test repairs to the
original base: a database cancellation handshake with owned-worker failure cleanup, and one
bounded bootstrap GET socket-reset retry in the synthetic SPA fixture. Existing product
assertions and all 49 task requirements remain. Each useful documentation patch is reviewed
again in this base, independently committed and pushed through all 14 local quick gates.
Every new head/tested merge/workflow/run/attempt needs new qualification.

The original workflow `0a7f448ce87b8792d53ac9bc7103f9c90d4d36b3`, base
`fbed656836e0c49aa13c03985d47194d97f3d875`, four source heads and their branches are frozen.
Their actual outcomes remain:

| Example | Original run / attempt | Complete acceptance |
| --- | --- | --- |
| Reader-only | [43184968747 / 1](https://github.com/lwtlab/reader/actions/runs/43184968747/attempts/1) | FAIL: `web-spa` |
| Hear-only | [43184988586 / 1](https://github.com/lwtlab/reader/actions/runs/43184988586/attempts/1) | Independently qualified 49/49 PASS |
| Shared core | [43185009521 / 1](https://github.com/lwtlab/reader/actions/runs/43185009521/attempts/1) | Independently qualified 49/49 PASS |
| Unknown path | [43185028867 / 1](https://github.com/lwtlab/reader/actions/runs/43185028867/attempts/1) | FAIL: `reader-unit` |

All four original plan/CPU/Hear components were independently checked. Both failed sources
executed 49 tasks with 48 PASS/one FAIL; independent receipt recomputation confirms that the
final aggregate rejects every partial acceptance. Their failed diagnostics are retained.
Original PASS results never qualify the new cohort. No original branch, environment policy,
operator pin, task contract, default status reporter or required check is rewritten.

## Independently checked second cohort (2026-11-12)

The exact tested public workflow is `df673187ee33020429376faaecda92ce793219c1`, with private base
`ec325430d64713cbe7d80800a7938ceadbdd279b`. These are separately bound runs; the
documentation branch recording them does not become their workflow/source identity. Original
cohort failures above remain unchanged.

| Class | Run / attempt | Private head | Actual tested merge | Complete qualification |
| --- | --- | --- | --- | --- |
| reader-only | [43200433975 / 1](https://github.com/lwtlab/reader/actions/runs/43200433975/attempts/1) | `6da6a2b7ebb1e4ddebce9286c844eb8c4bd45837` | `218b2a44b8d8662d6f9c910416ac27a54e79a34d` | 49/49 PASS |
| hear-only | [43200462150 / 1](https://github.com/lwtlab/reader/actions/runs/43200462150/attempts/1) | `e8e877ce3b20ccc9db7efda24ebab7336c6fcbce` | `a800b2a6b8f62f685e59294a3629a9ded5724607` | 49/49 PASS |
| shared-core | [43200491148 / 1](https://github.com/lwtlab/reader/actions/runs/43200491148/attempts/1) | `1756c3d8612b6344a1206d005b5eea999b3ec765` | `e2c8f4688eb804bf71266f7afc6df32f227b1a56` | 49/49 PASS |
| unknown | [43200518105 / 1](https://github.com/lwtlab/reader/actions/runs/43200518105/attempts/1) | `86fdcad318a8a1558e67c0f956596e7f66952d00` | `ca259ce7e6405c3c6fba406ff5bd5a0e6bc269f5` | 49/49 PASS |

All four runs each independently pass original Reader33, CPU9 and Hear7, all49
actual tasks, plus the actual Git change plan. Each preserves seven authenticated diagnostic
objects, checked artifact ZIP digests, original native/build identities, independently
recomputed receipts, complete coverage and run/attempt freshness. Component-only success
cannot supply final acceptance; all four original full graphs and final aggregates were checked.

| Class | Reader preparation | Reader graph | Workflow wall |
| --- | ---: | ---: | ---: |
| reader-only | 3.33 min | 49.31 min | 53.53 min |
| hear-only | 2.68 min | 44.33 min | 47.85 min |
| shared-core | 2.99 min | 48.48 min | 52.30 min |
| unknown | 3.90 min | 60.14 min | 64.88 min |

These measurements separate preparation from graph and wall time; they do not establish a
portable speedup against a different source or runner. The graph requirements were retained.
No new native/result preparation cache or shared writable task state was introduced.

Selection is still OFF: selected plans44/30/49/49 execute all49 in each case. Local mandatory14
and default full33/reporters remain unchanged. These optional receipts do not satisfy the
default required-check contexts. Private required-check enforcement remains unavailable under
the current repository plan; no enforcement or rollout is claimed. Actual selection enablement
requires separate review.

This cohort does not include the separate readonly-model or long-chunk native fixes, and
qualifies no real model inference, signing, notarization, installed-package UI, system audio or
physical hardware. No PR was merged, installer replaced, application Release created or site
deployed. Expired artifact bytes require a fresh separately bound run.
