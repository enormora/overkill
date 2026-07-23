# `@overkill-dev/engine`

Core Overkill primitives for defining executable test values and running an already-resolved test plan.

Top-level API:

- `createTestCase(options)`
- `createSuite(options)`
- `createTable(options)`
- `createTestPlan(root)`
- `execute(testPlan)`
- `createEngine()`
- `formatCaseId(caseId)`
- `validateReporterSinks(reporters)`
- `CaseId`, `TestId`, `TestPlan`, `ExecuteOptions`, `NonEmptyReadonlyArray`
- `Reporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`, `RunFacts`, `SinkDeclaration`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`
- `AssertionNode`, `AssertionResult`, `FailedCheck`, `TestFailure`, `RunnerError`

The top-level constructors share one default engine instance. Use
`createEngine()` when a collection needs isolated construction state for
`defined` counts and orphan detection.

Reporter lifecycle:

- `RealTimeReporter` receives `ReporterEvent` values while a run executes.
  Use it for terminal output, IDE integrations, and other live consumers.
- `FinalResultReporter` receives the completed `RunResult` once after the
  run finishes. Use it for reports, archives, and machine-readable output.
- A reporter has one lifecycle. If a package needs both modes, expose two
  reporters that share the same internal formatting or recording logic.

Reporter sinks:

- `stdout` and `stderr` can be `exclusive` or `shared`.
- `file`, `directory`, and `stream` sinks are exclusive.
- `memory` sinks are private to each reporter.
- `execute()` validates declared sink conflicts before emitting `run-start`.

Assertion bodies:

- `case.assert.equal(...)` and `case.assert.ok(...)` record lazy assertion
  nodes and continue.
- `case.require.equal(...)` and `case.require.ok(...)` record a lazy
  assertion node and short-circuit when it fails.
- `case.assert.done()` returns the non-empty assertion list for the engine to
  evaluate.
- `case.plan(count)` must be the first test-body call and must declare a
  positive integer assertion count.
