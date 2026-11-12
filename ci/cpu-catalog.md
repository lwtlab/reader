# Optional shared CPU catalog execution

Use `scope=catalog-cpu` on the independently reviewed `ci/catalog-cpu-20261112` ref. The existing
trusted private PR/main resolver binds exact head/base/tested merge/workflow and returns before
either full/CPU pending-status write. The dedicated fresh Ubuntu job uses Node 24.22.0/Python 3.12,
no persisted source credentials or result cache, and does not execute/report the default full/CPU jobs.

```sh
gh workflow run reader-private-verify.yml --repo lwtlab/reader --ref ci/catalog-cpu-20261112 \
  -f source_ref=<exact-reviewed-private-head> -f pr_number=<trusted-open-PR> \
  -f workflow_sha=<exact-reviewed-public-SHA> -f scope=catalog-cpu
```

The CPU adapter reads the private `verification-execution.mjs --scope llama-cpu --profile full` plan.
Before the first command it checks the independently pinned full plan, original nine-stage/eleven-command
contract, products/platform and complete ordered dependencies. It executes the supplied commands,
records actual exits/timings and stops at the first failure. Unexecuted stages remain NOT_RUN.
This now uses the same private `executePlan`/`runCommand` Unix ownership executor as Reader/Hear.
Before importing executable private modules, the public adapter independently checks the entire six-file
module graph. Each of the eleven ordered commands records exit/signal/resource results in encrypted
diagnostics. Interruption, output sink failure and failed owned-process cleanup cannot pass.
The public summary prints only allowlisted task IDs/statuses. Fresh Linux runner execution is covered;
Hear native/GUI, Windows process ownership and stateful concurrency are not qualified here.

The original CPU contract remains `63bb538e2077bdd6ad3759b06cd4a16e10264bc592de894c7cba70b83b8b8011`.
Its receipt still requires exact source/run/attempt, nine actual stages, stable clean parent source,
approved upstream mapping/revision, real compiled binaries/license/manifest and authenticated diagnostics.
The additional `catalog.json` binds the original private summary and exact legacy receipt bytes to
the selected catalog policy/contract and complete execution coverage. Schema v2 additionally requires
the shared executor policy/module digest and complete command-level records. Nine old adapter PASS
results cannot supply this proof. Process/resource details stay private. The sealing marker binds the
summary hash; replacing it after encryption cannot pass. Final `require-catalog` requires explicit
catalog mode, recomputes the companion, and rechecks live native/diagnostic hashes.

`reader-catalog-cpu-result-<run>-<attempt>` contains only `verification.json` and `catalog.json`.
`reader-catalog-cpu-encrypted-...` contains authenticated encrypted logs, original private summary/plan
and generated build bundle. Retention is seven days. Independently check both ZIP digests, authenticated
decryption, original summary/receipt hashes, canonical plan/coverage and every generated binary hash
before qualifying a run. No plaintext source, plan, logs, checkout or personal audio is public.

Only Linux CPU compilation/controls are in scope. Real model inference, Hear native compilation,
scripted GUI, signed installation and physical audio remain NOT_RUN. The old artifact prefixes and
status reporters cannot consume this companion scope. Default pins/gitlinks, 14/33 gates, polling,
selection, required-check policy and main remain unchanged; no PR merge, Release or deployment occurs.

This branch also updates the optional shadow-plan pins for the expanded catalog. Run `scope=shadow-plan`
on this same reviewed ref to qualify the generated Git controls and actual PR plan; all proposed tasks
remain NOT_RUN. The earlier independent shadow branch retains its original source/pins and results.
