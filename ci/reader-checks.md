# Independent checks without private Actions compute

The `public-integration` and `release-privacy` profiles use the independently
reviewed `ci/reader-checks-20261118` executor ref. They reuse the encrypted runner
and closed receipt envelope, with separate contracts and commit-status contexts:

| Profile | Context | Fixed tasks |
| --- | --- | --- |
| public-integration | reader-public/public-integration | Check scanner source parity; run the pinned public submodule's infrastructure tests and both website path builds |
| release-privacy | reader-public/release-privacy | Run the real scanner's synthetic negative controls; scan the extension directory |

The jobs install the existing fixed privacy-tools action: Gitleaks 8.30.1,
standalone ASAR reader 3.4.1, 7-Zip and squashfs readers. Tools missing, unsupported
formats, failed commands, dirty source or incomplete tasks cannot pass. Scanning
the extension directory preserves the original CI scope; final release payloads
continue through their separate exact-byte privacy gates.

Source resolution accepts current private main or trusted same-repository open
PRs and verifies generated merge parents. Public integration initializes only the
public delivery gitlink by HTTPS, without recursive submodules. The executor has
no status-write token or signing credentials. Raw output and synthetic diagnostic
artifacts are encrypted; only closed receipts and ciphertext are retained for
seven days. Reporting independently verifies the actual job, receipt ZIP digest,
run, attempt, workflow SHA, current source and latest pending status.

Discovery runs in this public repository. It is disabled until
`READER_CHECKS_AUTOMATIC=true` and `READER_CHECKS_WORKFLOW_SHA` equals the exact
reviewed executor ref SHA. It checks both profiles on every trusted source;
missing path metadata or scripts cannot silently waive a mandatory check. Each
source/contract is dispatched once, including failures. Completed pending entries
become errors only after rechecking source and latest status. Manual dispatch uses
`scope=public-integration` or `scope=release-privacy`; `scope=checks-discovery`
performs discovery without depending on any private Actions job.

Full33, CPU9 and the three existing reliability contracts and execution pins are
unchanged. The existing public CPU job preserves all nine private CPU commands,
build identity and generated binaries in encrypted diagnostics. It runs with full
verification, or independently with `scope=llama-cpu` on its existing executor.

After each scope has real qualification and correct private commit-status output,
the corresponding private variable may be enabled:
`READER_PUBLIC_INTEGRATION`, `READER_PUBLIC_RELEASE_PRIVACY`, or
`READER_PUBLIC_LLAMA_CPU`. Their private workflows retain an explicit
`workflow_dispatch` input `private_fallback=true`; default migrated execution skips
the duplicate job rather than inventing a success. These workflow changes take
effect on private main only after the application PR is integrated. Billing and
required-check plan restrictions are separate from executor migration.
