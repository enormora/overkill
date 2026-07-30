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
- `captureSourceLocation()`
- `unknownSourceLocation`
- `CaseId`, `TestId`, `TestPlan`, `ExecuteOptions`, `NonEmptyReadonlyArray`, `DeepComparable`
- `Reporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`, `RunFacts`, `SinkDeclaration`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`
- `AssertionNode`, `AssertionResult`, `AssertAssertionFacade`, `CaseAssertContext`
- `ThrownMatcher`, `ErrorMatcher`, `ExactThrownMatcher`
- `RequireAssertionFacade`, `FailedCheck`, `TestFailure`, `RunnerError`
- `Diff`, `DiffPathSegment`, `SerializedValue`, `SerializationBudget`

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
- `case.assert.throws(body, matcher)` checks synchronous thrown values.
  Promise-returning callbacks belong to `case.assert.rejects(...)`.
- `case.assert.rejects(thunk, matcher)` checks promise rejections and must be
  awaited before `case.assert.done()`.
- Thrown matchers are explicit objects. Use `{ exact: value }` for `Object.is`
  matching, or structured error fields such as `type`, `message`, `code`,
  `name`, and recursive `cause`. Structured error matchers require at least
  one field, and a string `message` is exact.
- `case.assert.annotated(message).*` and `case.require.annotated(message).*`
  record message-scoped checks without positional message overloads.
- `case.assert.annotated(message)(reference, ...)` annotates a custom
  assertion boundary.
- `case.assert.done()` is builder-only completion. It returns the non-empty
  assertion list for the engine to evaluate, and is not part of
  `AssertAssertionFacade`.
- `case.plan(count)` must be the first test-body call and must declare a
  positive integer assertion count.
- `FailedCheck` is discriminated by `kind`. Every failed check carries
  serialized `actual` and `expected` values, a typed mismatch `path`, and
  `diff: Diff | null`. Leaf checks carry value comparison data, composite
  checks carry child diagnostics, and foreign checks carry normalized
  thrown-error data.
- Failed checks carry concrete source locations. Engine-created assertion
  nodes capture lazy locations at the public assertion boundary. Direct raw
  assertion nodes must provide `location`; use `captureSourceLocation()` for
  accuracy or `unknownSourceLocation` when unavailable.
