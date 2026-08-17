# `@overkill-dev/run`

Run orchestration package for turning caller intent into resolved Overkill runs.

Top-level API:

- `RunCommand`
- `RunRequest`
- `RunFacts`
- `ResolvedRun`
- `orchestrator.resolve(command)`
- `orchestrator.run(command)`

Command-line business logic is exposed through `@overkill-dev/run/command-line`:

- `commandLineRunner.runTests(request)`
- `defineConfig(config)`
- `loadRunConfig({ cwd, configPath })`

The current runner accepts an explicit `TestPlan` through `RunCommand`. File
discovery, filtering, sharding, seeded ordering, resources, records, replay,
argv parsing, and command-selected lazy loading are separate runner milestones.
The command-line runner loads native Node config files, selects the default line
reporter when project config omits reporters, returns fallback diagnostics for
the binary wrapper to write, and maps run outcomes to stable exit codes.
