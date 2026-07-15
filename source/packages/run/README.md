# `@overkill-dev/run`

Run orchestration package for turning caller intent into resolved Overkill runs.

Public entry point: `source/packages/run/run.entry-point.ts`.

Public API shape: `RunRequest`, `RunFacts`, `ResolvedRun`, `resolveRun(request)`, and `run(request)`.

Current status: skeleton package. `resolveRun(request)` and `run(request)` throw explicit not-implemented errors.

Ownership boundaries: owns discovery, configuration-aware resolution, runner profiles, reporting attachment, and run orchestration. It delegates executable `TestPlan` execution to `@overkill-dev/engine`.
