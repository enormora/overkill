# Reporters

## Position

Reporters consume structured run data and produce human-readable or
machine-readable output. They are a **stable extension contract**:
first-party reporters and third-party reporters meet the same shape,
and the engine never bakes presentation choices into its core types.

This doc names the contract. [Package Architecture § Reporters](./package-architecture.md#reporters)
covers the package-family rationale; this is the interface.

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
    onFinish?(result: RunResult): void | Promise<void>;
};

type FinalResultReporter = {
    readonly kind: 'final-result';
    readonly name: string;
    readonly sinks: ReadonlyArray<SinkDeclaration>;
    onResult(result: RunResult): void | Promise<void>;
};
```

`RealTimeReporter` receives events as the run produces them; suitable
for terminal renderers, IDE integrations, MCP servers. The optional
`onFinish` lets a real-time reporter emit a final summary block.

`FinalResultReporter` is invoked once with the completed `RunResult`;
suitable for HTML reports, JSON dumps, archive writers.

A reporter cannot be both: pick the lifecycle that matches your data
shape. If you need both behaviours, ship two reporters that share an
implementation.

## Reporter Events

```ts
type ReporterEvent =
    | { kind: 'run-start'; plan: RunPlan; startedAt: string }
    | { kind: 'suite-start'; case: CaseId }
    | { kind: 'test-start'; case: CaseId; attempt: number }
    | { kind: 'test-progress'; case: CaseId; attempt: number; note: string }
    | { kind: 'test-end'; case: CaseId; attempt: number; outcome: TestOutcome; verdict: string; wallTimeMs: number }
    | { kind: 'suite-end'; case: CaseId }
    | { kind: 'runner-error'; error: RunnerError; attributedTo?: CaseId }
    | { kind: 'run-end'; result: RunResult };
```

Each event carries enough structured data that a reporter never has
to parse another reporter's output. Event identity is via `kind`;
new event variants are an additive change.

`test-progress` is intentionally low-detail — just an opaque `note`
string. Reporters that want richer progress data attach the
`TestDebugArtifact` (when `--debug` is on) rather than expanding this
event.

## Sinks And Conflict Resolution

A reporter declares the sinks it intends to write to:

```ts
type SinkDeclaration =
    | { kind: 'stdout'; conflictPolicy: 'exclusive' | 'shared' }
    | { kind: 'stderr'; conflictPolicy: 'exclusive' | 'shared' }
    | { kind: 'file'; path: string; conflictPolicy: 'exclusive' }
    | { kind: 'directory'; path: string; conflictPolicy: 'exclusive' }
    | { kind: 'memory'; conflictPolicy: 'shared' }
    | { kind: 'stream'; provided: WritableStream; conflictPolicy: 'exclusive' };
```

Resolution rules at run start:

-   two reporters claiming the same `stdout` or `stderr` with
    `conflictPolicy: 'exclusive'` is a configuration error; the run
    aborts with exit code 3 (configuration error) before any test
    runs
-   two reporters claiming `stdout` with `conflictPolicy: 'shared'`
    are allowed; they interleave on a per-line atomicity guarantee
    (no half-line bleed)
-   `file` and `directory` sinks are always exclusive; two reporters
    pointing at the same path is a configuration error
-   `memory` and `stream` sinks are always per-reporter-private

The orchestration layer (`@overkill/run`) computes the conflict
graph from declared sinks before starting any worker.

## Registration

Two attachment surfaces:

-   **Programmatic** — `runner.run({ reporters: [reporterA, reporterB] })`
    accepts already-instantiated reporter objects
-   **Config-driven** — `overkill.config.ts` lists reporter package
    names; the runner imports and instantiates them. Resolves to the
    same in-memory shape

Both forms produce the same `Reporter[]` array; the registration
mechanism is presentation. Per-run `--reporter <name>` flags add to
the list.

## Multi-Reporter Composition

Multiple reporters may run in the same execution. The orchestration
layer:

-   delivers each event to every real-time reporter in registration
    order
-   serializes delivery **per reporter**: a reporter never receives
    event `n+1` until its `onEvent` for event `n` has settled (or hit
    the timeout). Async reporters therefore provide natural
    backpressure and preserve event order within that reporter
-   awaits async event handlers but with a per-handler timeout
    (default 100 ms; longer is a reporter bug, the run continues)
-   isolates errors: a reporter throwing or rejecting does not
    affect other reporters or the run result. The error is surfaced
    as a `runner-error` event with subtype `reporter` to _other_
    reporters
-   delivers `RunResult` to every final-result reporter exactly once
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

-   a terminal reporter may render inline on the same event loop
-   an IDE or web reporter may buffer events and repaint on its own cadence
-   a heavyweight live UI may forward events to a separate worker,
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

-   not a concrete reporter (terminal, JSON, HTML, TAP) — those are
    separate packages with their own docs
-   not a guarantee that every event includes every conceivable
    field; reporters that need richer data declare it through
    additional artifacts (debug, witness, baselines), not by
    expanding events
-   not a recommendation to write a custom reporter — first-party
    reporters cover the common cases; third-party reporters exist
    for specialised pipelines

## Cross-References

-   [Package Architecture § Reporters](./package-architecture.md#reporters) — the package-family stance
-   [Runtime Behavior § Console Output Capture](./runtime-behavior.md#console-output-capture) — how reporters
    interact with captured stdout/stderr
-   [Failure Artifacts](./failure-artifacts.md) — the artifacts reporters consume
-   [Types Index](./types-index.md) — `RunPlan`, `RunResult`, `TestOutcome`,
    `RunnerError`, `CaseId`, `TestDebugArtifact`
