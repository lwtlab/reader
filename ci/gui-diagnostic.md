# Fixed synthetic HUD investigation

`selected-gui-diagnostic` runs only the existing three `model-switch.spec.ts`
cases, twenty times each, on macOS. It rebuilds the exact trusted unknown-path
PR merge and verifies the frozen executor/test/launcher inputs. It retains the
original mouse actionability checks and the model/language persistence assertions.
It does not change the tests, add retries or force clicks.

The source resolver and execution runner are separate. Only the resolver can read
the private API token, and it never writes a status. The execution runner reads
private source through the existing checkout key. Its report, failure traces and
private output are bounded and encrypted; only a small diagnostic record is public.

All outcomes are `NOT_QUALIFIED`. Even sixty successful controls cannot satisfy
Reader full33, Hear native7, selected-source coverage or release/audio acceptance.
A genuine GUI failure from an earlier full run remains a separate recorded failure.
An independent full selected run is required for source qualification.
