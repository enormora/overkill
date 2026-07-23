# Reporters

## Position

Reporters consume structured run data and produce human-readable or
machine-readable output. They are a **stable extension contract**:
first-party reporters and third-party reporters meet the same shape,
and the engine never bakes presentation choices into its core types.

This doc names the contract. [Package Architecture § Reporters](./package-architecture.md#reporters)
covers the package-family rationale; this is the interface.

## First-Party Reporter Set

The current first-party reporter set should be treated as part of the
settled concept:

- `@overkill-dev/reporter-dot`
  - real-time, stdout
  - minimal progress output for local or CI runs where compactness matters
- `@overkill-dev/reporter-line`
  - real-time, stdout
  - default human reporter for ordinary test runs
- `@overkill-dev/reporter-tap`
  - real-time, stdout
  - TAP-compatible stream for existing tooling ecosystems
- `@overkill-dev/reporter-json`
  - final-result
  - canonical machine-readable run result
- `@overkill-dev/reporter-html`
  - final-result
  - generic artifact/failure report for ordinary test families
- `@overkill-dev/reporter-benchmark-html`
  - final-result
  - benchmark-specific report with metric tables, comparisons, baseline
    deltas, machine metadata, and plotting-oriented output

The benchmark HTML reporter should show at least:

- benchmark groups and workloads
- recorded raw metrics
- normalized metrics when calibration is in use
- percentiles and other configured summary statistics
- budget/baseline deltas and pass/fail policy outcomes
- machine/runtime metadata relevant to comparability
- visual comparison output such as distributions or workload comparison
  plots

## Two Lifecycles

Reporters declare which lifecycle they participate in. The split
already exists in [Package Architecture](./package-architecture.md) and is settled.

```ts
type Reporter = RealTimeReporter | FinalResultReporter;

type RealTimeReporter = {
    readonly kind: 'real-time';
    readonly name: string;
    readonly sinks: ReadonlyArray<SinkDeclaration>;
    onEvent(event: ReporterEvent): void | Promise<void>;
    onFinish: ((result: RunResult) => void | Promise<void>) | null;
};

type FinalResultReporter = {
    readonly kind: 'final-result';
    readonly name: string;
    readonly sinks: ReadonlyArray<SinkDeclaration>;
    onResult(result: RunResult): void | Promise<void>;
};
```

`RealTimeReporter` receives events as the run produces them; suitable
for terminal renderers, IDE integrations, MCP servers. `onFinish` is
`null` when the reporter does not emit a final summary block.

`FinalResultReporter` is invoked once with the completed `RunResult`;
suitable for HTML reports, JSON dumps, archive writers.

A reporter cannot be both: pick the lifecycle that matches your data
shape. If you need both behaviours, ship two reporters that share an
implementation.

## Reporter Events

```ts
type ReporterEvent =
    | { kind: 'run-start'; facts: RunFacts; startedAt: string; }
    | { kind: 'suite-start'; suitePath: ReadonlyArray<string>; }
    | { kind: 'test-start'; case: CaseId; attempt: number; }
    | { kind: 'test-progress'; case: CaseId; attempt: number; note: string; }
    | {
        kind: 'test-end';
        case: CaseId;
        attempt: number;
        outcome: TestOutcome;
        verdict: TestOutcome['kind'];
        wallTimeMs: number;
    }
    | { kind: 'suite-end'; suitePath: ReadonlyArray<string>; }
    | { kind: 'runner-error'; error: RunnerError; }
    | { kind: 'run-end'; result: RunResult; };
```

Each event carries enough structured data that a reporter never has
to parse another reporter's output. Event identity is via `kind`;
new event variants are an additive change.

`suite-start` and `suite-end` identify the grouping by `suitePath`.
Tables contribute path segments because they are named groupings in
the resolved plan and in `RunResult.bySuite`.

`test-progress` is intentionally low-detail — just an opaque `note`
string. Reporters that want richer progress data attach the
`TestDebugArtifact` (when `--debug` is on) rather than expanding this
event.

## Sinks And Conflict Resolution

A reporter declares the sinks it intends to write to:

```ts
type SinkDeclaration =
    | { kind: 'stdout'; conflictPolicy: 'exclusive' | 'shared'; }
    | { kind: 'stderr'; conflictPolicy: 'exclusive' | 'shared'; }
    | { kind: 'file'; path: string; conflictPolicy: 'exclusive'; }
    | { kind: 'directory'; path: string; conflictPolicy: 'exclusive'; }
    | { kind: 'memory'; conflictPolicy: 'shared'; }
    | { kind: 'stream'; provided: WritableStream; conflictPolicy: 'exclusive'; };
```

Resolution rules at run start:

- two reporters claiming the same `stdout` or `stderr` with
  `conflictPolicy: 'exclusive'` is a configuration error; the run
  aborts with exit code 3 (configuration error) before any test
  runs
- two reporters claiming `stdout` with `conflictPolicy: 'shared'`
  are allowed; they interleave on a per-line atomicity guarantee
  (no half-line bleed)
- `file` and `directory` sinks are always exclusive; two reporters
  pointing at the same exact declared path is a configuration error
- `memory` and `stream` sinks are always per-reporter-private

Direct engine execution validates this subset before emitting
`run-start`. The orchestration layer (`@overkill-dev/run`) computes
the conflict graph from declared sinks before starting any worker.

## Registration

Two attachment surfaces:

- **Programmatic** — `runner.run({ reporters: [reporterA, reporterB] })`
  accepts already-instantiated reporter objects
- **Configuration-driven** — `overkill.config.ts` imports reporter factories or
  reporter values directly and passes instantiated reporters to the runner

Both forms produce the same `Reporter[]` array; the registration
mechanism is presentation.

Config should prefer explicit imported values, for example:

```ts
import { defineConfig } from '@overkill-dev/run';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { createBenchmarkHtmlReporter } from '@overkill-dev/reporter-benchmark-html';

export default defineConfig({
    reporters: [
        createLineReporter(),
        createBenchmarkHtmlReporter({
            outputDir: '.overkill/bench-report'
        })
    ]
});
```

There is intentionally no implicit third-party reporter discovery by naming
convention and no package-name lookup magic in the settled concept.

Bundle packages may re-export the built-in reporter factories so users do not
need to import each built-in reporter from its leaf package by default.

## Multi-Reporter Composition

Multiple reporters may run in the same execution. The orchestration
layer:

- delivers each event to every real-time reporter in registration
  order
- serializes delivery **per reporter**: a reporter never receives
  event `n+1` until its `onEvent` for event `n` has settled (or hit
  the timeout). Async reporters therefore provide natural
  backpressure and preserve event order within that reporter
- awaits async event handlers but with a per-handler timeout
  (default 100 ms; longer is a reporter bug, the run continues)
- isolates errors: a reporter throwing or rejecting does not
  affect other reporters or the run result. The error is surfaced
  as a `runner-error` event with subtype `reporter` to _other_
  reporters
- delivers `RunResult` to every final-result reporter exactly once
  after run completion

The serialization guarantee is **per reporter**, not global. A slow
reporter does not block sibling reporters from observing the same
event, but it does delay its own next callback. Reporter authors who
need throughput should buffer internally and return quickly rather than
holding the event pipeline open.

## Scheduling And UI Ownership

The orchestration layer owns **event delivery**, not UI rendering
policy. Its responsibility ends at producing ordered `ReporterEvent`s,
enforcing sink conflicts, and applying the per-reporter timeout/backpressure
rules above.

The reporter owns how it turns those events into a live UI:

- a terminal reporter may render inline on the same event loop
- an IDE or web reporter may buffer events and repaint on its own cadence
- a heavyweight live UI may forward events to a separate worker,
  subprocess, or external process that owns the animation loop

The default concept does **not** introduce a dedicated UI thread/process
for live reporters. That would add overhead to the cheapest microtest
path even when the user only wants plain stdout. If a reporter truly
needs an isolated render loop (for example a benchmark dashboard or a
richer TUI), that is a reporter implementation choice above the stable
reporter contract, not a runner-wide default.

A reporter that needs serialized output (e.g. a TAP reporter writing
to stdout) declares the sink as `exclusive`; a reporter that
tolerates interleaving declares `shared`.

## Default Line Reporter Rendering

`@overkill-dev/reporter-line` is the default human terminal reporter. It
renders the real-time event stream directly:

- passing tests render one compact line with the case identity and duration
- failing tests render a compact header, then one detail block for each
  structured failure in `outcome.failures`
- assertion failures render every failed check, not only the first check
- body errors render the normalized name, message, and a capped dimmed stack
- test-contract failures render the contract summary
- captured stdout and stderr need a separate output concept and are not part
  of the first failure-rendering pass

The failure header intentionally omits the first assertion summary:

```text
✗ users › parses display name (12 ms)
```

The useful failure text belongs in the detail blocks below the header. Value
rendering is focused in the first pass: primitives render exactly, strings
show a grapheme-window mismatch with a JavaScript code-unit index and an
canonical Unicode equivalence note when relevant, and arrays or objects add shallow
identity-oriented hints. Terminal output is capped to keep local failures
readable; machine-readable reporters still receive the structured result.

## Reporter Errors

A reporter that throws synchronously, rejects, or exceeds its
per-handler timeout produces a `RunnerError`:

```ts
{
    subtype: 'reporter',
    message: '<reporter-name>: <reason>',
    cause: <original error>,
}
```

The error is logged to the orchestration layer and propagated to
_other_ reporters via a `runner-error` event so they can render it.
The faulting reporter is _not_ removed from subsequent events; the
runner trusts it again until it fails again. (Removal would
encourage silent reporter death; visible repeated errors are
preferable.)

## What This Doc Is Not

- not a concrete reporter (terminal, JSON, HTML, TAP) — those are
  separate packages with their own documentation
- not a guarantee that every event includes every conceivable
  field; reporters that need richer data declare it through
  additional artifacts (debug, witness, baselines), not by
  expanding events
- not a recommendation to write a custom reporter — first-party
  reporters cover the common cases; third-party reporters exist
  for specialised pipelines

## Compatibility

Not every reporter is meaningful for every run family. Reporters may declare
compatibility requirements over the resolved run facts or result shape.

Examples:

- generic reporters such as `dot`, `line`, `tap`, `json`, and generic
  `html` can attach to ordinary test-family runs
- `benchmark-html` requires benchmark result data and benchmark-specific
  metrics

If a configuration attaches an incompatible reporter, orchestration should
reject it before execution with a configuration error rather than attempting
to render nonsense.

## Cross-References

- [Package Architecture § Reporters](./package-architecture.md#reporters) — the package-family stance
- [Runtime Behavior § Console Output Capture](./runtime-behavior.md#console-output-capture) — how reporters
  interact with captured stdout/stderr
- [Failure Artifacts](../authoring/failure-artifacts.md) — the artifacts reporters consume
- [Types Index](../reference/types-index.md) - `RunFacts`, `RunResult`, `TestOutcome`,
  `RunnerError`, `CaseId`, `TestDebugArtifact`
