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
- `CaseId`, `TestId`, `TestPlan`
- `Reporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`, `FailedCheck`, `RunnerError`

The top-level constructors share one default engine instance. Use
`createEngine()` when a collection needs isolated construction state for
`defined` counts and orphan detection.
