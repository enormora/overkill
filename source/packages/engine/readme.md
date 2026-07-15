# `@overkill-dev/engine`

Core Overkill primitives for defining executable test values and running an already-resolved test plan.

Top-level API:

- `createTestCase(options)`
- `createSuite(options)`
- `createTable(options)`
- `createTestPlan(root)`
- `execute(testPlan)`
- `Reporter`, `ReporterEvent`, `RealTimeReporter`, `FinalResultReporter`
- `RunResult`, `TestOutcome`, `PassOutcome`, `FailOutcome`, `SkipOutcome`, `InconclusiveOutcome`, `FailedCheck`, `RunnerError`
