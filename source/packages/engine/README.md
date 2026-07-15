# `@overkill-dev/engine`

Core Overkill engine primitives for test values, execution, reporting, and results.

Public entry point: `source/packages/engine/engine.entry-point.ts`.

Public API shape: branded test-node constructors, `createTestPlan(root)`, `execute(testPlan)`, reporter contracts, `RunResult`, and `TestOutcome`.

Current status: early implementation with legacy suite execution still present while the concept model is introduced.

Ownership boundaries: owns executable engine values and execution contracts. It does not own file discovery, configuration loading, CLI orchestration, or run intent resolution.
