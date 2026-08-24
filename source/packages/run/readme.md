# `@overkill-dev/run`

Run orchestration package for turning caller intent into resolved Overkill runs.

Top-level API:

- `RunCommand`
- `RunRequest`
- `RunFacts`
- `RunResourceBudgets`
- `RunResourceUsagePolicy`
- `ResolvedRun`
- `defineConfig(config)`
- `loadRunConfig({ cwd, configPath })`
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

The current runner accepts explicit file paths through `RunRequest.paths`.
Each file is imported as a native Node ESM module and must export a named
`testNode` value created by the selected engine. `RunCommand.engine` may be
`null` to use the shared public engine, or a custom `Engine` for programmatic
callers that also create their test nodes with that engine.

General file discovery, filtering, sharding, seeded ordering, records, replay,
and argv parsing are separate runner milestones. Direct prebuilt `TestPlan`
execution belongs to `@overkill-dev/engine` through `execute(testPlan)`. The
non-`runTests` command methods are fixed first-party entrypoints and currently
return argument errors until their command implementations land.

Resource usage measurement is explicit. Project config can enable it under
`profiles.<name>.resourceUsage.measure`; `RunRequest.measureResourceUsage`
can override that policy for one run. `resourceUsage.budgets` are thresholds
and require measurement, while `RunRequest.resourceBudgetOverrides` changes
individual thresholds for one run. Textual parsing for
`--measure-resource-usage` and `--resource-budget <name=value>` belongs to the
later command-line implementation milestone.

Runner profile names are project-owned. Names such as `microtest`,
`backend-http`, `ui-browser`, `ui.browser`, and `unit_fast` select profile
entries exactly. Behavior comes from the selected profile config, not from the
name. Profile names must be non-empty and contain only letters, numbers, dots,
underscores, and hyphens. The exact lowercase name `benchmark` is reserved for
benchmark commands. Every configured runner profile must declare
`testFamily: 'microtest'`; the selected profile's test family is recorded in
`RunFacts.execution.testFamily`.

Microtest profile execution is modeled with two independent fields:
`execution.processModel` is `in-process` or `supervised-process`, and
`execution.scheduling` is `concurrent` or `serial`. The default `microtest`
profile uses supervised concurrent execution. The selected values are recorded
in `RunFacts.execution` and drive the current explicit-file runner path.

`RunRequest.capabilityRestrictions.mode` controls the current microtest
restriction policy. The programmatic default is `enabled`; the command-line
runner also sets `enabled` explicitly. `supervised-process` microtests are
enforced in child processes started with Node's permission model. The parent
process remains unrestricted and owns reporters, output files, scheduling, and
supervision. Supervised children receive bootstrap read permission for the
project cwd and runner runtime files, receive no reporter write permission, and
drop `fs.read` before test bodies run.

`in-process` means no child process is spawned. Capability restrictions in this
mode are best-effort diagnostics only: Overkill observes native diagnostics,
`async_hooks` resources, and final global-state snapshots where possible, but it
cannot add `--permission` after the caller process has started. Calls such as
`process.abort()` may terminate the caller before a structured result can be
reported. The CLI bin skeleton starts with `--permission-audit`, so CLI
in-process microtests can observe extra permission-model diagnostics. Programmatic
in-process callers get those audit diagnostics only if their own Node process was
started with `--permission-audit`.

Capability results are classified as blocked, observed, or native-gap. Blocked
effects are denied by Node permissions. Observed effects are reported as
`runtime-policy` runner errors and fail the owning case, all active cases when
concurrent attribution is ambiguous, or the out-of-test boundary when no case is
active. Native gaps are documented runtime limitations; current examples include
sync bootstrap reads inside the cwd grant, `Date`, `Math.random()`, sync crypto
randomness, arbitrary `process.kill()`, and SQLite execution.

`RunCommand.engine` is supported for `in-process` runs. It is rejected for
`supervised-process` runs because a live custom engine object cannot cross the
process boundary reliably yet.

Config loading is common runner infrastructure, not plugin discovery.
The command-line runner loads native Node config files, selects the default
line reporter when project config omits reporters, defaults managed reporter
output to the plain renderer, returns fallback diagnostics for the binary
wrapper to write, and maps run outcomes to stable exit codes.
Installing a package does not add commands, and there is no installed-package
scan, dynamic command registry, or command plugin lifecycle.

Project config may set `outputRenderer` to adapt managed line intents, for
example to render GitHub Actions annotations from a brief stdout reporter.
Config files must export `config` as a named export. Default exports are
configuration errors.
