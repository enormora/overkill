# Failure Artifacts

## Purpose

This document defines the concept for artifacts emitted during failures,
updates, or diagnostic runs.

## Position

Overkill treats failure artifacts as first-class outputs of a run, not as
reporter-specific accidents.

Runtime monkey-patching is forbidden. The preferred model is explicit runner-owned boundaries,
structured results, and opt-in capture where the runner already controls the
process or worker.

Overkill should distinguish three artifact sources:

- **native artifacts** - produced directly by the engine or assertion
  system, such as diffs, plan mismatches, witnesses, retry metadata, and
  benchmark metrics
- **boundary-captured artifacts** - captured because the runner owns a
  subprocess or worker boundary, such as stdout/stderr, exit signals, and
  crash metadata
- **instrumented artifacts** - captured through explicit observability or
  interception, such as same-process console events or selected protocol
  traces

Examples:

- captured stdout / stderr (see [Runtime Behavior § Console Output Capture](../architecture/runtime-behavior.md#console-output-capture))
- temp files
- trace or event timelines
- current-vs-baseline diffs
- hedged duplicate conflicts
- benchmark sample data
- property-test witnesses
- deterministic-simulation witnesses
- browser screenshots or traces

Modern Node also provides some platform-native observability. For example,
diagnostics channels expose built-in `console.*` events, which makes strict
console policy and console-related artifacts possible without directly
patching `console.*`. This does **not** imply a general same-process capture
story for arbitrary filesystem or raw stdout behavior.

## Core Rule

The core preserves the structured information needed to build good failure
output, but reporters decide how to present it.

That means:

- a failing assertion is not the same thing as an internal runner error
- the engine preserves enough data for either a human-oriented reporter
  or a machine-oriented reporter
- reporters may choose very different presentations of the same
  underlying failure

Examples:

- a stdout reporter wants concise diff output
- a JSON reporter wants structured payloads
- an HTML reporter may want attached artifacts and richer navigation

The runner should also preserve provenance:

- whether an artifact is native, boundary-captured, or instrumented
- whether capture was always-on or opt-in
- whether the data is complete or best-effort

## Test Failures Versus Runner Errors

A clear conceptual distinction:

- **test failure** - the test ran and reported unmet expectations. The
  test produced a failed structured assertion result (or threw a
  recognised assertion failure through the throwing adapter).
- **runner or infrastructure error** - the system could not execute or
  observe the test correctly. Examples: fixture setup threw, a worker
  crashed, an unhandled rejection escaped the test window, a Node
  permission was denied unexpectedly, a loader hook errored.

The two categories are reported separately so reporters present them
differently. CI pipelines may treat them with different gating policies
(some teams want runner errors to fail fast and abort the rest of the
run; others want them to count alongside test failures).

## Attribution Rules

An ordinary exception or rejected promise awaited by the test body is a
`body-error` test failure. Global hook errors are separate runner failures.

Async errors and out-of-band events need a clear owner. The default
attribution policy:

- an unhandled rejection or uncaught exception emitted **during** a
  test's `run` is attributed to that test as a runner error and aborts
  the current execution boundary
- an error emitted between tests but during run-level setup/teardown is
  attributed to the run
- async work that fires after its originating test ended is reported as
  `attribution-drift`; the original case may appear in the structured
  cause, but `attributedTo` stays `null`
- an error from the runner's own machinery is a runner crash, surfaced
  as a top-level diagnostic

Attribution is best-effort and uses `AsyncLocalStorage` to correlate async
work with the originating test. `AsyncLocalStorage` is for attribution, not
for observing arbitrary side effects by itself. If the runner detects
attribution drift (an async chain escaped its test window), it records the
drift rather than silently mis-blaming a sibling test.

Tests that intend to test rejection paths use the assertion library's
explicit support (`scope.assert.rejects(() => promiseReturningCall(), { message: /expected/ })`)
rather than relying on the global hooks. The global hooks are the safety net, not the
mechanism.

## Runtime Policy Violations

Strict runtime policies, such as denied filesystem writes, denied network
access, denied `process.exit`, and strict `console.*` diagnostics, must report
structured runtime policy violations.

A runtime policy violation is a runner error, not an assertion failure. It
must include:

- the violated policy, such as `fs-write-denied` or `console-output-denied`
- the observed operation, such as `fs.writeFile`, `process.stdout.write`, or
  `console.log`
- the active `CaseId` when the violation happened during a test body
- `null` attribution only when the violation happened outside any active test
- a source location or stack when the runtime can provide it
- attribution confidence: `direct`, `active-case`, or `unknown`

Node permission denials use the `permission` runner-error subtype, not the
generic `runtime-policy` subtype. The cause preserves Node's raw permission
kind, the denied resource path or host when present, the normalized Overkill
capability, and whether the signal came from a thrown `ERR_ACCESS_DENIED` or a
permission diagnostics channel. In strict microtest execution, an attributed
permission runner error still gives the case verdict `runtime-policy`.

Owned-boundary profiles have the strongest attribution rule. Before evaluating
a test body, the worker must emit the active `CaseId`; any denied capability,
process-exit attempt, strict console event, crash, or hard-kill condition in
that window is attributed to that case unless the runner can prove it belongs
to run-level machinery.

Same-process profiles may use `AsyncLocalStorage` and runtime diagnostics for
attribution. If a violation is detected but the originating test is uncertain,
the runner reports attribution drift rather than assigning the violation to a
sibling test.

Human reporters should name the test file and test title for attributed
violations. Machine-readable reporters receive the `CaseId` and structured
violation payload so a message like `fs.writeFile was denied` is never detached
from the test that triggered it.

## Artifact Policy

Artifacts are:

- explicitly associated with stable test identities (see
  [Artifact Identity](../architecture/artifact-identity.md))
- clearly typed (subtype tag in `ArtifactId`)
- reviewable where appropriate (snapshots, baselines)
- discoverable by reporters and integrations (declared in the run
  record)
- optional when the run mode does not need them
- size-bounded with explicit truncation markers

Ordinary microtest failures do **not** imply a standalone on-disk file
per failed scope. The default microtest path stays cheap: assertion
results, concise diffs, and runner diagnostics live in the run record
and event stream. Separate per-test files are reserved for artifacts
whose value survives the run (witnesses, baselines) or for explicitly
requested diagnostic modes such as `--debug` / `--debug-scope`.

## Storage Policy

Artifacts produced during a run live in a per-run directory by default:

```text
.overkill/runs/<run-id>/artifacts/<case-id-derived-path>
```

The `.overkill` prefix is the runtime-state directory and is configurable via
`runtimeStateDir` in `overkill.config.ts` (default `.overkill`). Every path shown
in this section is rooted at that directory. See
[Configuration § Scope Of Configuration](../architecture/configuration.md#scope-of-configuration).

Artifacts that survive runs (baselines, witnesses) live in their own
directories:

- `test-baselines/` - all baseline subtypes
- `.overkill/witnesses/` - replay witnesses (gitignored by default; can
  be promoted into the repository when valuable)
- `.overkill/corpus/` - fuzzing/property regression corpus
- `.overkill/runs/` - detailed run records and per-run artifacts

Per-run artifacts are retained and pruned with the run history policy defined
in [Reproducibility § Retention And Maintenance](../architecture/reproducibility.md#retention-and-maintenance).
The default policy keeps artifacts for the most recent 5 successful persisted
runs and for failing persisted runs from the last 7 days. Run-record retention,
compact history, and history maintenance are owned by Reproducibility, not by
artifact subtypes.

Size caps:

- captured stdout/stderr per test: 1 MiB by default, truncated with
  marker
- trace/event timeline per test: 10 MiB by default
- structured assertion value serialization: bounded by engine policy before
  reporter delivery
- structured diff rendering: capped at 100 lines / 8 KiB in human reporter
  output

All caps are configurable per profile.

## Integration Resource Evidence

Runner-managed integration execution prepares first-party HTTP transcripts,
process stdout/stderr, and simulated HTTP scenario witnesses automatically.
`withFailureArtifacts(resource, prepare)` adds explicit custom collectors.
Collectors receive the actual owner handle, even when consumers receive a
projected handle.

Attempt preparation runs after the body settles and before scope cleanup or
resource disposal. It also runs for passing bodies, because cleanup can fail.
Prepared evidence is provisional until the attempt fails. Passing attempts
discard it, while explicitly attached evidence retains its existing policy.
Retry and hedge selection apply after failure promotion.

Precisely correlated interactions use the full work identity and attempt.
Shared lifetime output remains run-scoped and is retained when a consumer or
resource disposal fails. Each retry starts a fresh transcript scope. A shared
resource collector also receives a `lifetime` capture before disposal.

First-party transcript and process streams checkpoint bounded received
prefixes during execution. Interrupted captures retain their completeness
metadata. Custom collectors are best effort after a crash unless they have
already checkpointed evidence. Collector errors remain artifact errors,
preserve body outcomes, prevent integration retries, and allow cleanup.

Attempt captures provide `attachments.witness(...)`. Simulation witnesses
record the actual producing library/version, a versioned simulation payload,
scenario, nullable decimal simulation seed, and nullable runtime/fault state.
Seedless simulations use `null`; the ordering seed is never substituted.
Complete witness files live under `runtimeStateDir/witnesses`, with unique run,
work, attempt, and artifact identities. This capture API does not add replay
commands or history maintenance.

## Witnesses And Replay Artifacts

Failing property tests and deterministic-simulation tests produce
witnesses: serialised, replayable artifacts that reproduce the failure
without re-running shrinking or rebuilding simulator state. They exist for
the test families whose outcome depends on generated or simulator-owned
state rather than only on source code:

- property tests record the failing generated input and shrink state
- deterministic-simulation tests record the seed, scenario, and
  simulation-owned replay payload

Run-record and replay semantics live in
[Reproducibility](../architecture/reproducibility.md). This doc owns only
the witness artifact shape and its attachment/reporting behavior.

This is the canonical witness schema; other documents reference it rather
than restating fields.

```ts
import type { JsonValue } from 'type-fest';

type WitnessHeader = {
    readonly version: 1;
    readonly producedBy: { readonly library: string; readonly libraryVersion: string; };
    readonly case: CaseId;
};

type EncodedPropertyInput = {
    readonly format: { readonly name: string; readonly version: number; };
    readonly codec: { readonly name: string; readonly version: number; };
    readonly payload: JsonValue;
};

type PropertyWitnessTarget =
    | { readonly kind: 'property-value'; }
    | {
        readonly kind: 'forall';
        readonly location: SourceLocation;
        readonly occurrence: number;
        readonly key: string | null;
    };

type PropertyWitnessFile = WitnessHeader & {
    readonly kind: 'property';
    readonly seed: string;
    readonly runtimes: ReadonlyArray<RuntimeId>;
    readonly target: PropertyWitnessTarget;
    readonly counterexample: EncodedPropertyInput;
    readonly failureIdentity: JsonValue | null;
    readonly shrinkPath: ReadonlyArray<number> | null;
};

type SimulationWitnessFile = WitnessHeader & {
    readonly kind: 'simulation';
    readonly seed: string | null;
    readonly simulation: { readonly name: string; readonly payload: JsonValue; };
    readonly resource: { readonly name: string; } | null;
    readonly scenario: string | null;
    readonly runtimeSnapshot: JsonValue;
    readonly faultConfiguration: JsonValue;
};

type WitnessFile = PropertyWitnessFile | SimulationWitnessFile;
```

Persisted seeds are decimal strings, matching the existing simulation
producer; loaders restore numeric seed values internally. Property input
payloads carry separate transport-format and application-codec versions.
The `payload` is lossless graph JSON, not a truncated assertion value.
`shrinkPath` is nullable diagnostic provenance and is not needed for direct
input replay. `failureIdentity` is nullable when reliable classification is
unavailable. The property package validates its producer-specific payload;
the engine owns the shared envelope and attachment identity.

First-class property targets replay their declared body directly. Nested
`forall` targets also record the invocation location and occurrence or an
explicit key, and replay enters the enclosing case. The source and runtime
identities are resolved against the current project rather than importing
executable decoder code from a witness. Replay reports the current outcome;
historical evidence does not guarantee that changed code still fails.

Compatibility, corpus promotion, and codec behavior are defined in
[Property-Based Testing Resolution](./higher-test-layers.md#property-based-testing-resolution).

A witness is also a failure artifact - it attaches to the failing case via
`ArtifactId` and is rendered by reporters as a replay command line:

```text
overkill replay-witness .overkill/witnesses/users__round-trip__c0ffee.witness.json
```

An incompatible `version` causes the reader to fail fast rather than run
with subtly-different shrinking semantics.

## Captured Output

Default policy (covered in [Runtime Behavior](../architecture/runtime-behavior.md)):

- owned-boundary runs may capture stdout/stderr per test and attribute it
  via `AsyncLocalStorage` correlation plus worker/process ownership
- same-process runs should not promise universal ambient stdout capture by
  default
- `console.*` usage may be observed through Node diagnostics channels in
  modern Node and attached as instrumented artifacts when the profile
  enables it
- captured output is suppressed in default reporter for passing tests and
  printed for failing tests inline with the failure summary
- case-scoped captured data is delivered with the test completion event;
  run-scoped captured data is delivered through the final run result
  available on the run completion event
- captured data uses a JSON-safe UTF-8 text payload with byte length,
  capture time, stream, and truncation metadata; future storage backends may
  preserve exact bytes for richer artifact files
- captured data is preserved in machine-readable reporting regardless of
  terminal rendering

## Hedged Duplicate Conflicts

When hedged duplicate execution observes conflicting outcomes for the same
case, the case fails with a native `hedged-conflict` artifact. The payload
records the authoritative evidence, the conflicting evidence, and the `WorkId`
that was duplicated. This is a test failure, not a runner crash or retry.
Cancelled or semantically matching slower duplicates are trace or debug data,
not normal case artifacts.

## Diff Artifacts

A failed assertion's diff is structured (see [Assertions And Results](./assertions-and-results.md)):

```ts
type DiffArtifact = {
    readonly diff: Diff | null;
    readonly expected: SerializedValue;
    readonly actual: SerializedValue;
    readonly path: ReadonlyArray<DiffPathSegment>;
};
```

Reporters render this. The runner does not pre-render. Value serialization is
bounded before delivery. Human reporter truncation is a separate display cap.

## Retry Interaction

Retries are not a microtest concept.

Integration profiles opt in through `retries: { maxAttempts: 3 }`. The limit
includes the initial attempt. Omission or a limit of one runs once. Only
completed assertion failures, ordinary body errors, and cooperative soft
timeouts retry after cleanup succeeds. Contract, cleanup, fixture, permission,
runtime-policy, leak, crash, resource-exhaustion, and hedged-conflict failures
are terminal. Reporter failures independently fail the run.

Failure artifacts preserve:

- which attempt failed (`AttemptId`)
- which attempt finally passed or failed
- whether artifacts come from the first failure, last failure, or all
  attempts (configurable; default keeps first-failure artifacts plus
  final-attempt artifacts)
- a `retried: { attempts: number, finalVerdict: TestVerdict }`
  summary on the test result

This prevents retries from hiding useful debugging evidence. The default
configuration is conservative: keep the first failure (often the most
diagnostic) plus the final outcome.

`retries.artifacts` selects `first-failure-and-final` (default),
`last-failure-and-final`, or `all`. Every result keeps a non-empty `attempts`
history regardless of retention. `retried` is `null` unless another attempt
actually ran. Durations sum across attempts; counts remain per logical work.
The top-level verdict remains authoritative after coordinator arbitration.
Case artifact IDs require `AttemptId`; run-scoped IDs require `attempt: null`.
Output capture shares its byte budget across the whole attempt chain.

Retries stay inside one placement attempt without recollection or reseeding.
Hedging retains the winner's chain, and conflicts preserve both chains. Retry
metadata does not add attachment APIs, records, replay, or debug transcripts;
those remain owned by their respective features.

## Process Crash Artifacts

When a worker process dies mid-test (segfault, OOM, native-addon crash):

- the test is recorded as a runner error with subtype `crash`
- captured output up to the crash is preserved
- the worker's exit signal and any core-dump pointer are included
- a `WorkerCrash` artifact is attached, including:
  - timestamp
  - exit signal (SIGSEGV, SIGABRT, etc.)
  - identifier of the worker (PID, pool index)
  - the test active at the time of the crash
  - any environment metadata helpful for triage (Node version,
    loaded native addons)

See [Runtime Behavior § Process Crash Handling](../architecture/runtime-behavior.md#process-crash-handling) for the run-level
policy (replacement workers, crash-budget abort).

## Resource Exhaustion Artifacts

When a supervised worker exceeds an enforced resource budget:

- the test is recorded with verdict `resource-exhausted`
- a runner error with subtype `resource-exhaustion` is attributed to the
  active test
- captured output and the latest resource samples are preserved
- a `ResourceExhaustion` artifact is attached

```ts
type ResourceExhaustion = {
    readonly timestamp: string;
    readonly metric:
        | 'javaScriptEngineHeapBytes'
        | 'residentSetBytes'
        | 'residentSetGrowthBytesPerSecond'
        | 'activeResourceCount'
        | 'libuvHandleCount';
    readonly budget: number;
    readonly observed: number;
    readonly enforcement: 'v8-heap-limit' | 'sampled' | 'post-test-diagnostic';
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly workerId: string;
    readonly activeCase: CaseId;
};
```

The artifact must be legible without reading logs. It records the budget that
was configured, the observed value that breached it, and whether the value came
from a V8 heap ceiling, sampled Node telemetry, or completion-time diagnostics.

See [Runtime Behavior § Resource Budgets](../architecture/runtime-behavior.md#resource-budgets) for
the enforcement model.

## Sources

- [Pytest - terminal output and reports](https://docs.pytest.org/en/stable/how-to/output.html)
- [Playwright - Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Vitest - Reporters](https://vitest.dev/guide/reporters)
