# `@overkill-dev/engine`

Core Overkill primitives for defining executable test values and running an already-resolved test plan.

Top-level API:

- `createTestCase(options)`
- `createSkippedTestCase(options)`
- `createRoot(options)`
- `createSuite(options)`
- `createTable(options)`
- `createTestPlan(root)`
- `execute(testPlan)`
- `createEngine()`
- `formatCaseId(caseId)`
- `validateReporterSinks(reporters)`
- `defineReporter(factory)`
- `defineOutputRenderer(factory)`
- `createPlainOutputRenderer()`
- `captureSourceLocation()`
- `unknownSourceLocation`
- `CaseId`, `TestId`, `TestRoot`, `TestPlan`, `ExecuteOptions`, `NonEmptyReadonlyArray`, `DeepComparable`
- `Reporter`, `DefinedReporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`, `RunFacts`, `SinkDeclaration`, `OutputLineIntent`, `OutputRenderer`, `DefinedOutputRenderer`, `ReportingContext`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`
- `AssertionNode`, `AssertionResult`, `AssertAssertionFacade`, `InFlightTask`, `TestScopeAssertContext`
- `ThrownMatcher`, `ErrorMatcher`, `ExactThrownMatcher`
- `RequireAssertionFacade`, `FailedCheck`, `TestFailure`, `RunnerError`
- `Diff`, `DiffPathSegment`, `SerializedValue`, `SerializationBudget`
- `TestAnnotations`, `TestAnnotationsInput`, `TestControls`, `TestControlsInput`
- `TestFamily`, `CaptureMode`

The top-level constructors share one default engine instance. Use
`createEngine()` when a collection needs isolated construction state for
`defined` counts and orphan detection.

Direct execution:

```ts
import { createRoot, createSkippedTestCase, createTestCase, createTestPlan, execute } from '@overkill-dev/engine';

export const testNode = createTestCase({
    body(scope) {
        scope.assert.true(true, { message: 'passes' });
        return scope.assert.collect();
    },
    annotations: {},
    controls: {},
    title: 'passes'
});

const skippedNode = createSkippedTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    reason: 'unsupported platform',
    title: 'platform-specific'
});

const root = createRoot({
    children: [ testNode, skippedNode ],
    annotations: {},
    controls: {},
    title: 'direct'
});

await execute(createTestPlan(root));
```

Runner-owned direct Node entrypoints are exposed by `@overkill-dev/run` and
`@overkill-dev/test` through `runIfMain(import.meta, testNode, options?)`.
Those entrypoints load runner config, match the direct file to a profile, and
use default runner reporters when no explicit reporters are configured.

Aggregate direct execution:

```ts
import { createRoot, createSuite, createTestPlan, execute } from '@overkill-dev/engine';
import { testNode as orders } from './orders.test.ts';
import { testNode as users } from './users.test.ts';

export const testNode = createSuite({
    children: [ users, orders ],
    annotations: {},
    controls: {},
    name: 'all'
});

const root = createRoot({
    children: [ testNode ],
    annotations: {},
    controls: {},
    name: 'all'
});

await execute(createTestPlan(root));
```

Direct `createTestPlan(...)` calls require an explicit `createRoot(...)`.
The root carries run-level name, annotations, and controls, but it does not contribute to
case suite paths or `RunResult.bySuite`.

Annotations and controls are closed structured input. Unknown fields fail
during test construction or collection. `TestPlanCase.annotations` and
`TestPlanCase.controls` contain the resolved data after root, suite, table,
and case propagation.

Test scope lifecycle:

- `scope.signal` is aborted after the body returns or throws and before
  cleanup callbacks run.
- `scope.cleanup(callback)` registers teardown callbacks. Callbacks run in
  reverse registration order and may be async.
- `scope.drainMicrotasks()`, `scope.yieldToNextTurn()`, and
  `scope.settleAsyncWork()` replace ad-hoc queue waits in test bodies.
- `scope.startInFlight(operation)` starts background Promise work now and
  returns a handle with `wait()` and `rejects(...)`. The task must settle and
  be observed before the test ends.

Reporter lifecycle:

- `RealTimeReporter` receives `ReporterEvent` values while a run executes.
  Use it for terminal output, IDE integrations, and other live consumers.
- `FinalResultReporter` receives the completed `RunResult` once after the
  run finishes. Use it for reports, archives, and machine-readable output.
- `dispose` is required and nullable on both reporter lifecycles. When
  present, `execute()` calls it exactly once after the run or after reporter
  validation fails.
- Reporter callback failures are returned in `RunResult.runnerErrors` with
  subtype `reporter`. `run-end` failures are included before final-result
  `onResult` and real-time `onFinish` callbacks receive the result.
- `onResult`, `onFinish`, and `dispose` failures are added to the returned
  `RunResult`. Final callbacks are not repeated with sibling final-phase
  failures, and `dispose` failures are not sent back through reporters.
- A reporter has one lifecycle. If a package needs both modes, expose two
  reporters that share the same internal formatting or recording logic.

Reporter sinks:

- `stdout-raw` and `stderr-raw` own a stream directly and cannot share it.
- `stdout-managed-primary` and `stderr-managed-primary` return line intents
  through the reporter callback. A stream can have one managed primary.
- `stdout-managed-supplemental` and `stderr-managed-supplemental` can
  cooperate with a managed primary and other supplemental reporters.
- Reporters without managed stdout or stderr sinks return only `void` or
  `Promise<void>` from reporter methods.
- `file` and `directory` sinks conflict on the same declared path.
- `stream` sinks are private to each reporter.
- `memory` sinks are private to each reporter.
- `execute()` validates declared sink conflicts before emitting `run-start`.
- Managed output uses one `DefinedOutputRenderer`. `createPlainOutputRenderer()`
  renders each line intent as plain text.
- Reporter and output renderer definitions receive one `ReportingContext` per
  delivery. Use it to render known source-location paths with the shared
  project-root policy.

Assertion bodies:

- `scope.assert.*` records non-gating assertion nodes and continues.
- `scope.require.*` records narrow gating assertion nodes and short-circuits
  when one fails.
- Custom assertions are imported assertion reference values:
  `scope.assert(resultOk, result)`. Narrowing references may also be used with
  `scope.require(resultOk, result)`. Define reusable assertion references with
  `@overkill-dev/assert`.
- Async custom assertions must be awaited before `scope.assert.collect()`.
- `scope.assert.throws(body, matcher)` checks synchronous thrown values.
  Promise-returning callbacks belong to `scope.assert.rejects(...)`.
- `scope.assert.rejects(thunk, matcher)` checks promise rejections and must be
  awaited before `scope.assert.collect()`.
- Thrown matchers are explicit objects. Use `{ exact: value }` for `Object.is`
  matching, or structured error fields such as `type`, `message`, `code`,
  `name`, and recursive `cause`. Structured error matchers require at least
  one field, and a string `message` is exact.
- `scope.assert.annotated(message).*` and `scope.require.annotated(message).*`
  record message-scoped checks without positional message overloads.
- `scope.assert.annotated(message)(reference, ...)` annotates a custom
  assertion boundary.
- `scope.assert.collect()` is builder-mode syntax sugar. It returns the
  non-empty assertion list for the engine to evaluate, and is not part of
  `AssertAssertionFacade`.
- `scope.plan(count)` must be the first test-body call and must declare a
  positive integer assertion count.
- `FailedCheck` is discriminated by `kind`. Every failed check carries
  serialized `actual` and `expected` values, a typed mismatch `path`, and
  `diff: Diff | null`. Leaf checks carry value comparison data, composite
  checks carry child diagnostics, and foreign checks carry normalized
  thrown-error data.
- Failed checks carry a non-empty `sourceLocations` chain. Each entry is a
  `SourceLocation`, either `{ kind: 'known', file, line, column }` or
  `{ kind: 'unknown' }`. Engine-created assertion nodes capture lazy
  locations at the public assertion boundary. Direct raw assertion nodes must
  provide `location`; use `captureSourceLocation()` for accuracy or
  `unknownSourceLocation` when unavailable.
