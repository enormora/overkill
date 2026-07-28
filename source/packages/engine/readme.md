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
- `defineCompositeAssertion(options)`
- `defineNarrowingCompositeAssertion(options)`
- `CaseId`, `TestId`, `TestPlan`, `ExecuteOptions`, `NonEmptyReadonlyArray`
- `Reporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`, `RunFacts`, `SinkDeclaration`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`
- `AssertionNode`, `AssertionResult`, `AssertAssertionFacade`, `CaseAssertContext`
- `RequireAssertionFacade`, `FailedCheck`, `TestFailure`, `RunnerError`

The top-level constructors share one default engine instance. Use
`createEngine()` when a collection needs isolated construction state for
`defined` counts and orphan detection.

Reporter lifecycle:

- `RealTimeReporter` receives `ReporterEvent` values while a run executes.
  Use it for terminal output, IDE integrations, and other live consumers.
- `FinalResultReporter` receives the completed `RunResult` once after the
  run finishes. Use it for reports, archives, and machine-readable output.
- `dispose` is required and nullable on both reporter lifecycles. When
  present, `execute()` calls it exactly once after the run or after reporter
  validation fails.
- A reporter has one lifecycle. If a package needs both modes, expose two
  reporters that share the same internal formatting or recording logic.

Reporter sinks:

- `stdout` and `stderr` can be `exclusive` or `shared`.
- `file`, `directory`, and `stream` sinks are exclusive.
- `memory` sinks are private to each reporter.
- `execute()` validates declared sink conflicts before emitting `run-start`.

Assertion bodies:

- `case.assert.*` records non-gating assertion nodes and continues.
- `case.require.*` records narrow gating assertion nodes and short-circuits
  when one fails.
- Custom assertions are imported assertion reference values:
  `case.assert(resultOk, result)`. Narrowing references may also be used with
  `case.require(resultOk, result)`.
- `defineCompositeAssertion(...)` creates assert-only references.
  `defineNarrowingCompositeAssertion(...)` creates sync references accepted by
  both `case.assert` and `case.require`.
- Async custom assertions must be awaited before `case.assert.done()`.
- `case.assert.annotated(message).*` and `case.require.annotated(message).*`
  record message-scoped checks without positional message overloads.
- `case.assert.annotated(message)(reference, ...)` annotates a custom
  assertion boundary.
- `case.assert.done()` is builder-only completion. It returns the non-empty
  assertion list for the engine to evaluate, and is not part of
  `AssertAssertionFacade`.
- `case.plan(count)` must be the first test-body call and must declare a
  positive integer assertion count.
- `FailedCheck` is discriminated by `kind`. Leaf checks carry value
  comparison data, composite checks carry child diagnostics, and foreign
  checks carry normalized thrown-error data.
