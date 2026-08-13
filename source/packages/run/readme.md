# `@overkill-dev/run`

Run orchestration package for turning caller intent into resolved Overkill runs.

Top-level API:

- `RunCommand`
- `RunRequest`
- `RunFacts`
- `ResolvedRun`
- `resolveRun(command)`
- `run(command)`

The current runner accepts an explicit `TestPlan` through `RunCommand`. File
discovery, config loading, filtering, sharding, seeded ordering, resources,
records, replay, and CLI parsing are separate runner milestones.
