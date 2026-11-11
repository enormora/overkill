# `@overkill-dev/engine`

Core Overkill primitives for defining executable test values and running an already-resolved test plan.

Every case receives `scope.seed` and a fresh `scope.random` handle derived from
the run seed and complete work identity. The handle provides inclusive safe
integer sampling, bytes, collection choices, UUIDs, and independent child streams
through `split()`. Filtering, ordering, process boundaries, and retries preserve
the case stream. Direct `execute(plan, options)` accepts `seed: bigint`; without
a supplied run context, the run seed defaults to `0n`.

Top-level API:

- `createTestCase(options)`
- `createThrowingTestCase(options)`
- `createWorkloadTestCase(options)`
- `createSkippedTestCase(options)`
- `createRoot(options)`
- `createSuite(options)`
- `createTable(options)`
- `createTestPlan(root)`
- `execute(testPlan)`
- `defineTestFamily(definition)`
- `prepareFamily(request)`
- `execute(collectedFamilyRun, options)`
- `createEngine()`
- `formatCaseId(caseId)`
- `workIdentityKey(workId)`
- `validateReporterSinks(reporters)`
- `defineReporter(factory)`
- `defineOutputRenderer(factory)`
- `createPlainOutputRenderer()`
- `captureSourceLocation()`
- `unknownSourceLocation`
- `CaseId`, `TestId`, `TestRoot`, `TestPlan`, `ExecuteOptions`, `NonEmptyReadonlyArray`, `DeepComparable`
- `Reporter`, `DefinedReporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`, `RunFacts`, `SinkDeclaration`, `OutputLineIntent`, `OutputRenderer`, `DefinedOutputRenderer`, `ReportingContext`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`
- `PropertyCaseEvidence`, `PropertyInvocationEvidence`, and `PropertyFailureObservation` for bounded property failure diagnostics on case results, attempt results, and test-end events
- `AssertionNode`, `AssertionResult`, `AssertAssertionFacade`, `InFlightTask`, `TestScopeAssertContext`
- `ThrownMatcher`, `ErrorMatcher`, `ExactThrownMatcher`
- `RequireAssertionFacade`, `FailedCheck`, `TestFailure`, `RunnerError`
- `Diff`, `DiffPathSegment`, `SerializedValue`, `SerializationBudget`
- `TestAnnotations`, `TestAnnotationsInput`, `TestControls`, `TestControlsInput`
- `TestFamilyId`, `CaptureMode`

The top-level constructors share one default engine instance, including
installed package copies in the same process. Use
`createEngine()` when a collection needs isolated construction state for
`defined` counts and orphan detection.

`createWorkloadTestCase({ title, annotations, controls, definitionLocations,
workloads })` creates one logical test node with a non-empty list of
`{ id: WorkloadId, body: TestBody }` entries. Names must be unique, including
Unicode normalization equivalents. Identity records are copied and frozen.
Each body retains its own resource metadata and becomes an executable work
item during planning. All entries share one `CaseId`; their `WorkId.workload`
values distinguish execution, artifacts, and assignments. `defined` counts
the node once; `discovered` and `planned` count expanded work items.

The constructor is family-neutral. Structural custom `Engine` implementations
must expose it along with the existing constructors.

`canonicalIdentityJson(value)` encodes JSON identity data with canonical key
ordering and Unicode normalization. `snapshotValidatedJson(value, validate)`
copies and deeply freezes finite, acyclic JSON data while applying a validator
to each value. Workload authoring shares these operations with runner data
handling through the engine package.

Direct execution:

```ts
import {
    createRoot,
    createSkippedTestCase,
    createTestCase,
    createThrowingTestCase,
    createTestPlan,
    execute
} from '@overkill-dev/engine';

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

const throwingNode = createThrowingTestCase({
    body(scope) {
        scope.assert.equal(1, 1);
    },
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'legacy assertion'
});

const root = createRoot({
    children: [ testNode, throwingNode, skippedNode ],
    annotations: {},
    controls: {},
    title: 'direct'
});

await execute(createTestPlan(root));
```

Direct execution is serial by default. Concurrent execution requires an
explicit admission policy, for example
`execution: { mode: 'concurrent-in-process', maxConcurrency: 5 }`.
Use `maxConcurrency: 'unlimited'` for unbounded admission. A case's timeout and
duration start after admission, so time waiting for a slot is excluded.

Each execution owns its native error and async-leak observations. Nested and
overlapping executions keep separate ownership, and observations stop when
execution completes or fails. Runner watchdogs and reporter callbacks do not
become test-policy effects. Native runtime methods remain unchanged.

`ExecuteOptions.retryPolicy` is `null` by default. Set `{ maxAttempts: 3 }`
to allow up to three completed attempts, including the first. Explicit
non-integration test families reject this policy; family-neutral plans can
opt in directly. Assertion failures, ordinary body errors, and cooperative
soft timeouts can retry after cleanup succeeds. Infrastructure, contract, and
cleanup failures cannot retry. Reporter failures still fail the run, but do
not change retry eligibility.

`PerTestResult.attempts` preserves each attempt and `retried` records actual
retries, or is `null` when the case ran once. The top-level verdict is the
logical result, and duration sums all attempts. Real-time `test-end` events
have `completion: 'retry' | 'final'`; only final completions count as completed
cases. Event attempt numbers and artifact `AttemptId.index` are zero-based.

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
and case propagation. `controls.duplicateExecution` is `null` by default;
`idempotent` opts a case into safe duplicate execution, while `forbidden`
clears inherited duplicate safety for that case.

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
- `CaseRunnerError` lets runner-aware wrappers report case-attributed runner
  errors without turning setup or teardown failures into ordinary body
  failures.
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

Benchmark integrations can attach a calibration-only execution body with
`attachBenchmarkCalibrationBody` and retrieve it with `readBenchmarkCalibrationBody`.
The runner uses that body to acquire calibration dependencies during capture while
preserving ordinary benchmark execution. Calibration evidence and reference-context
types are exported alongside benchmark result types.

Witness files use the engine-owned version-1 envelope.
`parseWitnessFile(value)` from `@overkill-dev/engine` validates parsed JSON and
returns a property or simulation witness, throwing `ZodError` for invalid
envelopes or unsupported envelope versions. It does not decode inputs or execute
replay. Producer-specific payload compatibility is validated separately.

Property invocation evidence includes a nullable `summary` with phase accounting,
seeds, input coverage, and exhaustive traversal state. `original` and `retained`
observations are jointly present or jointly null. Progress snapshots use the same
shape as final case and attempt results; historical summaries may be unavailable.

## Family Definitions

`defineTestFamily` creates a branded `TestFamily<Settings>` with an implementation
ID/version, explicit module reference (or `null` for local use), supported
features, a settings parser, and a lazy backend loader. Importing or inspecting a
definition does not load its backend. Definitions do not register global state.

`parseSettings` returns a deeply frozen JSON copy. Unsupported values and cycles
are rejected; nested containers use the shared JSON snapshot depth limit of 64.
`TestFamilyId` is the stable string stored in plans and results.

Executable work, work units, and artifacts carry a nullable `familyVariant`.
Non-null variants distinguish implementations' executable targets while retaining
logical case identity. Neutral variants preserve existing identity keys.

## Failure artifact policy

`execute` accepts `failureArtifacts` with captured-output, assertion serialization,
and human rendering limits. Omission uses `defaultFailureArtifactPolicy`.
Concurrent and nested executions keep their serialization budgets isolated;
diagnostic policy does not change collected test identity.

Reporter contexts from older runners may omit `failureArtifacts`. Rendering then
uses the active execution policy or its defaults.

`RunArtifact` includes `WorkerCrashArtifact` and `ProcessExhaustionArtifact`.
They preserve active `WorkId` and `AttemptId` evidence, unavailable metadata as
`null`, and capture provenance. Case-owned artifacts accompany `test-end`;
run-scoped artifacts accompany the final result. These variants need no
attachment backend or standalone files. Existing runner-error classifications
and case verdicts remain authoritative.

### Debug diagnostics

Supplied execution options require `debug: { mode: 'off' }`,
`debug: { mode: 'all' }`, or `debug: { mode: 'selected', work: [...] }`.
Calling `execute(plan)` keeps debug recording off. Selected identities never
change which tests execute.

Both test scopes expose `scope.debug.includeRecording({ name, recorded })`.
The callback returns application-owned event arrays and is never invoked when
debug is off. Provider failures are artifact runner errors; case verdicts remain
intact.

`TestDebugArtifact` is a typed, JSON-safe result artifact. Measurements identify
shared observation windows and sampling limits. Incomplete `debug-checkpoint`
events are diagnostic progress; completed evidence appears in `test-end.artifacts`
and `RunResult.artifacts`. Direct engine execution keeps this evidence in memory.

## Direct family execution

Use an engine-created plan, an explicit family definition, and an absolute
project root. Select work by its prepared identity. The engine rejects empty,
unknown, or duplicate selections. Authored skips remain in the result.

```ts
await using prepared = await engine.prepareFamily({
    testPlan,
    testFamily,
    settings,
    projectRoot,
    signal
});
const collected = await prepared.collect({
    workIds: prepared.testPlan.cases.map((testCase) => testCase.workId),
    signal
});
const result = await engine.execute(collected, { ...executionOptions, signal });
```

Runtime families use ordinary body execution. Analysis families supply evidence
through the engine and never invoke test bodies. Both use the same reporters.
The top-level functions use the default engine.
