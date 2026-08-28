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
- `orchestrator.runWithReporterDelivery(command)`

Command-line business logic is exposed through `@overkill-dev/run/command-line`:

- `commandLineRunner.runTests({ cwd, configPath, runRequest })`
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

The current runner accepts explicit file paths through `RunRequest.paths` and
`commandLineRunner.listTests(...)`. Each file is imported as a native Node ESM
module and must export a named `testNode` value created by the selected engine.
`commandLineRunner.listTests(...)` resolves those explicit modules and prints a
plain plan tree without executing tests or loading fallback reporters.
`RunCommand.engine` may be `{ kind: 'default' }` to use the shared public engine,
`{ kind: 'instance', engine }` for in-process programmatic callers that also
create their test nodes with that engine, or `{ kind: 'module', moduleUrl,
exportName, exportKind }` for supervised programmatic callers that need the
child process to load the engine without parent-side user-module execution.

Profile file discovery, filtering, sharding, seeded ordering, records, and
replay are separate runner milestones. Direct prebuilt `TestPlan` execution
belongs to `@overkill-dev/engine` through `execute(testPlan)`. The command
methods other than `runTests` and `listTests` are fixed first-party entrypoints
and currently return argument errors until their command implementations land.

Resource usage measurement is explicit. Project config can enable it under
`profiles.<name>.resourceUsage.measure`; `RunRequest.measureResourceUsage`
can override that policy for one run. `resourceUsage.budgets` are thresholds
and require measurement, while `RunRequest.resourceBudgetOverrides` changes
individual thresholds for one run. The `@overkill-dev/test` binary parses
`--measure-resource-usage` and `--resource-budget <name=value>` into those
typed request fields.

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
`process.exit()`, `process.abort()`, `process.kill()`, `process.execve()`, and
`process.on('message', ...)` are blocked by the shared runtime policy when that
policy is active. The CLI bin skeleton starts with `--permission-audit`, so CLI
in-process microtests can observe extra permission-model diagnostics.
Programmatic in-process callers get those audit diagnostics only if their own
Node process was started with `--permission-audit`.

Capability results are classified as blocked, observed, or native-gap. Blocked
effects are denied by Node permissions or by the shared runtime policy.
Observed effects are reported as `runtime-policy` runner errors and fail the
owning case, all active cases when concurrent attribution is ambiguous, or the
out-of-test boundary when no case is active. Native gaps are documented runtime
limitations; current examples include sync bootstrap reads inside the cwd grant,
`Date`, `Math.random()`, sync crypto randomness, and SQLite execution.

Live instance engines are supported for `in-process` runs. They are rejected
for `supervised-process` runs because an object with executable functions
cannot cross the process boundary. Supervised custom engines must use a module
selection whose file URL is inside the run cwd and whose export is either an
engine value or a synchronous getter returning an engine.

Config loading is common runner infrastructure, not plugin discovery.
The command-line runner loads native Node config files, selects the default
line reporter when the selected profile and project config both omit reporters,
defaults managed reporter output to the plain renderer, returns fallback
diagnostics for the binary wrapper to write, and maps run outcomes to stable
exit codes. Fallback diagnostics contain runner errors that were not delivered
to any terminal-capable reporter callback during `orchestrator.runWithReporterDelivery(command)`.
Raw terminal reporters are counted as delivered when their callback succeeds
because their writes are intentionally opaque to the dispatcher. Resource
exhaustion maps to exit code 5 before generic runner errors because
`resource-exhaustion` is also a runner error subtype. Profile reporters replace
top-level project reporters for the selected run; otherwise top-level reporters
are the fallback.
Installing a package does not add commands, and there is no installed-package
scan, dynamic command registry, or command plugin lifecycle.

Project config may set `outputRenderer` to adapt managed line intents, for
example to render GitHub Actions annotations from a brief stdout reporter.
Config files must export `config` as a named export. Default exports are
configuration errors.
