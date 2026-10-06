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
- `runIfMain(import.meta, testNode, options?)`
- `orchestrator.resolve(command)`
- `orchestrator.run(command)`
- `orchestrator.runWithReporterDelivery(command)`

Configuration loading and authoring are also exposed through
`@overkill-dev/run/config` for packages that need the config-owned surface
without importing orchestration.

`runIfMain(import.meta, testNode, options?)` is the supported companion for
bare `node path/to/file.test.ts` execution. It returns immediately when the
module was imported, loads config from `process.cwd()` only for the main
module, selects the matching profile from `profiles.<name>.files`, falls back
to the configured `microtest` profile, and uses the default line reporter when
neither options, the selected profile, nor project config provides reporters.
Direct execution always runs in the current process. When the selected profile
uses `supervised-process`, it prints a warning and preserves the profile's
scheduling and run facts while disabling child-process isolation for that
direct Node invocation.

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

Programmatic selection helpers are exposed through `@overkill-dev/run/filters`:

- `all(filters)`
- `any(filters)`
- `not(filter)`
- `caseId(id)`
- `equals(field, value)`
- `contains(field, value)`
- `glob(field, pattern)`
- `file(pattern)`
- `owner(value)`
- `params(value)`
- `parseRunFilterExpression(expression)`
- `runtime(name)`
- `runtimeDimension(name, dimensionName, value)`
- `runtimeScenario(runtime, scenario, value)`
- `runtimeVariant(name, variantId)`
- `suite(value)`
- `tag(value)`
- `title(value)`

Resource wrapper lifecycle coordination is exposed through
`@overkill-dev/run/resource-lifecycle` for packages that compose
runner-managed resource scopes with test-body authoring wrappers.

Scoped transcript storage is exposed through
`@overkill-dev/run/transcript-store` for runner and test integrations. Test
authors should use the higher-level transcript API from `@overkill-dev/test`.

The current runner accepts explicit file paths through `RunRequest.paths` and
profile file discovery through `profiles.<name>.files`. Profile files may use
top-level `include` and `exclude`, or mutually exclusive named `sets` whose
entries use the same include/exclude shape. Named sets must be non-empty and
non-overlapping. Explicit files bypass top-level discovery, but when the
selected profile uses `sets`, each explicit file must match exactly one set.
Each discovered or explicit file is imported as a native Node ESM module and
must export a named `testNode` value created by the selected engine.
Attach broad module annotations to that exported top-level node.
`commandLineRunner.listTests(...)` resolves those modules and prints a plain
plan tree without executing tests or loading fallback reporters.
`RunCommand.engine` may be `{ kind: 'default' }` to use the shared public engine,
`{ kind: 'instance', engine }` for in-process programmatic callers that also
create their test nodes with that engine, or `{ kind: 'module', moduleUrl,
exportName, exportKind }` for supervised programmatic callers that need the
child process to load the engine without parent-side user-module execution.

Programmatic selection filters are supported through `RunRequest.selection`.
The current helpers select by stable case id, file, title, suite, table params,
tag, ownership, public runtime key, runtime matrix variant id, runtime
dimension, and exact runner-visible runtime scenario bindings. Runtime identity
filters use case-sensitive equality. Scenario filtering is programmatic and has
no CLI grammar. Test family matching is intentionally absent because one run is
already bound to one profile test family.
`parseRunFilterExpression(expression)` parses the CLI filter grammar into the
same `RunFilter` tree. Runs use seeded ordering by default. Pass
`RunRequest.order: 'lexical'` for deterministic source-stable order, or
`RunRequest.order: 'plan'` for programmatic callers that need an already
materialized order. `RunRequest.shard` uses one-based `{ index, total }`
values and partitions the filtered work-unit set by stable identity hash.
General recording, replay, and `--last-failed` are separate runner milestones. Direct
prebuilt `TestPlan` execution belongs to `@overkill-dev/engine` through
`execute(testPlan)`.
The command methods other than `runTests` and `listTests` are fixed first-party
entrypoints and currently return argument errors until their command
implementations land.

Coverage is explicit per run. `RunRequest.coverage` defaults to `false` in
first-party callers, and the `@overkill-dev/test` binary maps `--coverage` to
`true`. Coverage requests are valid only for microtest profiles and are
recorded in `RunFacts.execution.coverage`, with the resolved policy in
`RunFacts.coveragePolicy`. Microtest profiles may configure
coverage `outputs`, loaded or all-files `sources`, line/function/branch
`thresholds`, and a config-file-relative `outputDir`. The default outputs are
V8 and LCOV. An empty `outputs` array keeps raw coverage without rendering
reports.

Type-only TypeScript files, including modules containing documentation comments
or empty export markers, do not contribute to coverage totals. Executable
imports and runtime declarations remain covered.

Source patterns apply to original files when scripts declare source maps.
Generated script paths do not need to match those patterns. Broken declared
maps or references fail coverage; scripts without declarations use JavaScript
coverage. Known test sources are excluded automatically. Mixed test bundles
use `coverage.sources.exclude` to exclude their test originals.

All-files reporting emits 0% when selected runtime sources were never loaded.
A scope containing no executable sources fails, including scopes matching only
types or no files. Native data is retained on reporting failures. Replay and
automatic coverage cleanup await the replay and record-retention workflows.

Integration runs with resource or runtime wrappers also persist a `RunRecord`.
The record starts after collection and before resource acquisition. Attachment
files are copied under `<runtimeStateDir>/runs/<id>/artifacts/`; artifact paths
are relative to the project root. Completed and interrupted records retain
attachment metadata and available content. Reporter completion events include
attachments from their case attempt.

Integration profiles accept `attachments` with these default limits:

| Setting               | Default |
| --------------------- | ------: |
| `maxInlineBytes`      |   1 MiB |
| `maxArtifactBytes`    |  10 MiB |
| `maxScopeBytes`       |  10 MiB |
| `maxScopeAttachments` |     100 |

Scope budgets cover the full retry chain. Retry artifact policy also determines
which attachment files remain. Cancelled or matching hedged peers are discarded;
conflicting executions retain their attachments in the conflict evidence.
Microtest profiles reject attachment configuration.

Coverage runs persist a `RunRecord` at `<runtimeStateDir>/runs/<id>.json`.
The same ULID names the default `<runtimeStateDir>/runs/<id>/coverage`
directory. Configured output directories keep raw data under `raw/<id>`.
Records preserve the request, decimal seed, resolved facts, execution policy,
project-relative coverage paths, and result artifacts. The started record
precedes coverage setup and imports; early failures may have `facts: null`.
Completion includes reporter and cleanup errors. Required persistence failures
fail the run. Bare integration runs, microtest runs without coverage, and
`orchestrator.resolve()` do not create records.

Resolved runtime identities contain selected scenario bindings. They flow into
`RunFacts`, duration-history keys, reporter labels, and artifact IDs so replay
metadata and captured evidence identify the selected scenario.

Resource usage measurement is explicit. Project config can enable it under
`profiles.<name>.resourceUsage.measure`; `RunRequest.measureResourceUsage`
can override that policy for one run. `resourceUsage.budgets` are thresholds
and require measurement, while `RunRequest.resourceBudgetOverrides` changes
individual thresholds for one run. The `@overkill-dev/test` binary parses
`--measure-resource-usage` and `--resource-budget <name=value>` into those
typed request fields.

Runner timing collection is explicit beyond the always-present summary.
Project config can set `profiles.<name>.timings.collection` to `summary` or
`precise`; omitted timing policy defaults to `summary`. `RunRequest` uses
`timingCollection: 'profile-default'` by default and can upgrade one run with
`timingCollection: 'precise'`. The `@overkill-dev/test` binary parses
`--timings` into that precise request. Strategies that consume timing-derived
duration facts also require precise collection.

Output capture is run-level intent by default. `RunRequest.capture` is
`buffered` by default; `live` passes capture-capable stdout and stderr through
without creating `log-capture` artifacts. Non-microtest test controls may
override capture per test. Microtest profiles reject live capture and per-test
capture controls. There is no project config field for capture mode.

Runner profile names are project-owned. Names such as `microtest`,
`backend-http`, `ui-browser`, `ui.browser`, and `unit_fast` select profile
entries exactly. Behavior comes from the selected profile config, not from the
name. Profile names must be non-empty and contain only letters, numbers, dots,
underscores, and hyphens. The exact lowercase name `benchmark` is reserved for
benchmark commands. Every configured runner profile must declare
`testFamily: 'microtest'` or `testFamily: 'integration'`; the selected
profile's test family is recorded in `RunFacts.execution.testFamily`.

Configured microtest profiles may set `files.include` and `files.exclude`.
`include` is required when `files` is present; `exclude` defaults to `[]`.
With no run paths, the selected profile's files policy discovers test modules.
Explicit file paths bypass the files policy. Directory paths require a files
policy, filter the profile-discovered file set, and cannot be mixed with file
paths.

Configured integration profiles require a `files` policy. Integration tests
are not governed by `RunRequest.capabilityRestrictions`; that request field is
part of the microtest runtime model only.

Integration profiles can opt into `retries: { maxAttempts: 3 }`. The limit
includes the initial attempt; omission or `maxAttempts: 1` runs once.
`retries.artifacts` accepts `first-failure-and-final` (default),
`last-failure-and-final`, or `all`. Microtest profiles reject this setting.
Only completed assertion failures, ordinary body errors, and cooperative soft
timeouts can retry. Cleanup, contract, resource, runtime-policy, and crash
failures are terminal. Each attempt gets fresh per-case resources and timeout
state; shared resources and the selected work identity stay unchanged.

Results retain every attempt's outcome, verdict, and duration. `retried` is
`null` for one attempt and otherwise records the actual attempt count and final
verdict. Counts and duration history record one logical case, with durations
summed across attempts. Case artifacts carry a zero-based `AttemptId`;
run-scoped artifacts carry `null`. Captured output remains capped at 1 MiB per
logical work item across all attempts.

Microtest profile execution is modeled with two independent fields:
`execution.processModel` is `in-process` or `supervised-process`, and
`execution.scheduling` is `concurrent` or `serial`.
`execution.maxConcurrency` is a positive safe integer or `'unlimited'` and
limits active cases per executor. It defaults to `5`; serial scheduling still
admits one case at a time. The default `microtest` profile uses supervised
concurrent execution. The selected values are recorded in `RunFacts.execution`
and drive runner planning.

Integration profiles default to `worker-pool` with concurrent scheduling.
`worker-pool` uses bounded Node worker threads, collects once in a worker,
then resolves selected cases into `WorkUnit`s. `workDistribution` controls
whether those units are packed by file, by individual case, or by named
profile file-set groups. Group distribution requires `files.sets`. Each group
names one or more file sets and can override granularity, in-unit scheduling,
local order, and worker lifecycle. Unmatched selected file sets are rejected
by default, or run as plain file units with profile defaults when
`unmatched: 'file'` is configured. `RunFacts.execution` contains the frozen
`PlacementPlan`: work units, resolved per-unit policy, local worker lanes, and
the deterministic initial lane assignment used by execution. The plan also
freezes resource ownership for every selected `per-run`, `per-file`, and
`per-suite` boundary. Shared resources either stay on one reusable executor
lane or use a dedicated infrastructure worker that projects handles to the
assigned work. Local-only handles are rejected when the resolved placement
requires projection. Worker-pool
placement defaults to `assignmentPolicy: 'case-count-balanced'`, which places
larger selected work units first and balances lane load by selected case count
and resource capacity weight.
Use `assignmentPolicy: 'stable'` to preserve source-order round-robin
placement.
Worker-pool size defaults to one fewer than host parallelism, with a minimum of
one and a maximum of eight. The planner caps that target by host parallelism,
`execution.maxWorkers`, and the work-unit count. `RunRequest.workers` replaces
the automatic target before those caps are applied. A serial or single-worker
key shared by every selected unit caps the resolved executor count at one.
Resolved worker-count facts are recorded in `RunFacts.execution.workerCount`;
resource-owner workers are not included.
`dispatchPolicy: 'dynamic-lease'` is the default worker-pool dispatch policy.
It leases pending work to compatible idle lanes and may split eligible
not-started units along `WorkId` boundaries. Split children keep derived trace
identities linked to the frozen parent `WorkUnitId`; the parent remains the
identity used for sharding and initial placement. Serial scheduling, group
granularity, fresh-worker units, serial keys, and single-worker keys make a unit
indivisible. `dispatchPolicy: 'static-assignment'` follows the frozen lane
assignment without splitting.
Execution records a complete attempt-centric placement trace for later run
record persistence. Each attempt includes its exact `WorkId` subset, lane,
opaque executor identity, completion duration, and explicit recovery outcome.
Runner boundary and worker phase details remain in run timings.
Worker-pool `execution.hedging` defaults to `{ mode: 'off' }`. `{ mode: 'on',
minimumDelayMilliseconds, durationMultiplier }` duplicates only explicitly
safe single-case stragglers under `dynamic-lease`; `static-assignment` rejects
hedging. Slower duplicates are cancelled, matching duplicate outcomes are
discarded, and conflicting outcomes fail the case with a `hedged-conflict`
artifact.
`workerLifecycle: 'reuse'` reuses worker threads between units.
`workerLifecycle: 'fresh-worker-per-unit'` creates disposable isolation per
unit. `supervised-process` remains available when a single process-isolated
child boundary is preferred.

Resource requirements resolve after work-unit formation. A `serial` or
`exclusive-resource` requirement makes its containing file or group unit
serial without serializing unrelated units. `single-worker` pins matching work
to one lane without changing in-unit scheduling. For `supervised-process`, a
serial or exclusive requirement anywhere in the selected plan makes the
containing process plan serial.
Planning rejects incompatible runtime or resource definitions, invalid resource
dependency scopes, mixed worker lifecycles for one hard constraint, and worker
capacity that cannot satisfy the resolved lifecycle lanes. These failures are
reported as `RunExecutionPlanError` with deterministic structured conflicts
before test execution begins.
Direct `RunConfig` values may set `execution.hostProcess` for worker-pool
profiles. `{ kind: 'direct' }` keeps the worker-thread pool in the coordinator
process. `{ kind: 'child', nodeArguments: [...] }` starts one supervised host
process around the worker-thread pool, applies validated Node/V8 arguments to
that host only, and records the derived host reasons in `RunFacts.execution`.
Loaded project config files reject `hostProcess` for now.

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
cannot add `--permission` after the caller process has started. Runtime methods are never monkey-patched. Native events observe user IPC
listener registration, and native diagnostics observe `process.execve()` attempts.
Registration is not prevented. Premature in-process exit receives a synchronous
diagnostic and changes successful exit status to failure; abort reporting and
arbitrary `process.kill()` detection are not guaranteed. Supervised parents
validate shared IPC payloads, terminate children on unexpected IPC, and require
valid completion even after exit code zero. Receipt does not identify the sending
test. Terminal child shutdown and output draining are bounded to one second. Final attempt capture remains open during draining without reviving execution. The CLI bin skeleton starts with `--permission-audit`, so CLI
in-process microtests can observe extra permission-model diagnostics.
Programmatic in-process callers get those audit diagnostics only if their own
Node process was started with `--permission-audit`.

Capability results are classified as blocked, observed, or native-gap. Blocked
effects are denied by native permissions.
Observed effects are reported as `runtime-policy` runner errors and fail the
owning case, all active cases when concurrent attribution is ambiguous, or the
out-of-test boundary when no case is active. Native gaps are documented runtime
limitations; current examples include sync bootstrap reads inside the cwd grant,
`Date`, `Math.random()`, sync crypto randomness, arbitrary process signaling,
in-process outgoing IPC without an owned parent, and SQLite execution.

Live instance engines are supported for `in-process` runs. They are rejected
for `supervised-process` and `worker-pool` runs because an object with
executable functions cannot cross the execution boundary. Custom engines for
those process models must use a module selection whose file URL is inside the
run cwd and whose export is either an engine value or a synchronous getter
returning an engine.

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
