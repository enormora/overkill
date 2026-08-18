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
- `commandLineRunner.listTests(context)`
- `commandLineRunner.replayRun(context)`
- `commandLineRunner.replayWitness(context)`
- `commandLineRunner.baseline.update(context)`
- `commandLineRunner.baseline.apply(context)`
- `commandLineRunner.baseline.bootstrap(context)`
- `commandLineRunner.baseline.list(context)`
- `commandLineRunner.baseline.diff(context)`
- `commandLineRunner.bench.runBenchmarks(context)`
- `commandLineRunner.bench.listBenchmarks(context)`
- `commandLineRunner.bench.baseline.update(context)`
- `commandLineRunner.bench.baseline.apply(context)`
- `commandLineRunner.bench.baseline.bootstrap(context)`
- `commandLineRunner.bench.baseline.list(context)`
- `commandLineRunner.bench.baseline.diff(context)`
- `defineConfig(config)`
- `loadRunConfig({ cwd, configPath })`

The current runner accepts an explicit `TestPlan` through `RunCommand`. File
discovery, filtering, sharding, seeded ordering, resources, records, replay,
and argv parsing are separate runner milestones. The non-`runTests` command
methods are fixed first-party entrypoints and currently return argument errors
until their command implementations land.

Config loading is common command-line infrastructure, not plugin discovery.
The command-line runner loads native Node config files, selects the default
line reporter when project config omits reporters, defaults managed reporter
output to the plain renderer, returns fallback diagnostics for the binary
wrapper to write, and maps run outcomes to stable exit codes.
Installing a package does not add commands, and there is no installed-package
scan, dynamic command registry, or command plugin lifecycle.

Project config may set `outputRenderer` to adapt managed line intents, for
example to render GitHub Actions annotations from a brief stdout reporter.
