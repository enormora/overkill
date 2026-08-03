# `@overkill-dev/engine`

Core Overkill primitives for defining executable test values and running an already-resolved test plan.

Top-level API:

- `createTestCase(options)`
- `createSuite(options)`
- `createTable(options)`
- `createTestPlan(root)`
- `execute(testPlan)`
- `runIfMain(import.meta, root, options?)`
- `createEngine()`
- `formatCaseId(caseId)`
- `validateReporterSinks(reporters)`
- `captureSourceLocation()`
- `unknownSourceLocation`
- `CaseId`, `TestId`, `TestPlan`, `ExecuteOptions`, `RunIfMainOptions`, `NonEmptyReadonlyArray`, `DeepComparable`
- `Reporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`, `RunFacts`, `SinkDeclaration`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`
- `AssertionNode`, `AssertionResult`, `AssertAssertionFacade`, `TestScopeAssertContext`
- `ThrownMatcher`, `ErrorMatcher`, `ExactThrownMatcher`
- `RequireAssertionFacade`, `FailedCheck`, `TestFailure`, `RunnerError`
- `Diff`, `DiffPathSegment`, `SerializedValue`, `SerializationBudget`

The top-level constructors share one default engine instance. Use
`createEngine()` when a collection needs isolated construction state for
`defined` counts and orphan detection.

Direct Node execution:

```ts
import { createTestCase, runIfMain } from '@overkill-dev/engine';
import { createDotReporter } from '@overkill-dev/reporter-dot';

export const testNode = createTestCase({
    body(scope) {
        scope.assert.true(true, { message: 'passes' });
        return scope.assert.collect();
    },
    metadata: {},
    name: 'passes'
});

await runIfMain(import.meta, testNode, {
    reporters: [ createDotReporter() ]
});
```

Aggregate direct Node execution:

```ts
import { createSuite, runIfMain } from '@overkill-dev/engine';
import { createDotReporter } from '@overkill-dev/reporter-dot';
import { testNode as orders } from './orders.test.ts';
import { testNode as users } from './users.test.ts';

export const testNode = createSuite({
    children: [ users, orders ],
    metadata: {},
    name: 'all'
});

await runIfMain(import.meta, testNode, {
    reporters: [ createDotReporter() ]
});
```

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
- Failed checks carry concrete source locations. Engine-created assertion
  nodes capture lazy locations at the public assertion boundary. Direct raw
  assertion nodes must provide `location`; use `captureSourceLocation()` for
  accuracy or `unknownSourceLocation` when unavailable.
