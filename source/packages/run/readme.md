# `@overkill-dev/run`

Run orchestration package for turning caller intent into resolved Overkill runs.

Top-level API:

- `RunCommand`
- `RunRequest`
- `RunFacts`
- `ProcessBudgets`
- `ProcessUsagePolicy`
- `ResolvedRun`
- `defineConfig(config)`
- `normalizeConfig(config)`
- `loadConfig({ cwd, configPath })`
- `runIfMain(import.meta, testNode, options?)`
- `orchestrator.resolve(command)`
- `orchestrator.run(command)`
- `orchestrator.runWithReporterDelivery(command)`
- `orchestrator.freezePolicy({ command, source, moduleBoundary })`
- `orchestrator.initialize(command)`
- `orchestrator.createExecutionSession(options)`
- `parseFrozenMicrotestPolicy(value)`
- `parseRunSelection(value)`, `parseRunResult(value)`, `parseRunnerError(value)`
- `serializeRunDiagnostics(value)`, `parseSerializedRunDiagnostics(value)`
- `createNodeFileStore()`, `FileStore`
- `createRandomRunSeed()`
- `withFileModuleBoundary(boundary, operation)`
- `workIdentityKey(work)`

`createExecutionSession` accepts a frozen microtest command, a lifecycle module
and factory export, and an environment choice. `profile-default` reuses the
in-process collected plan or starts a supervised child; `fresh-invocation`
starts a fresh host for in-process profiles. `environmentLifetime` reports
`reused` or `fresh` before execution.

The lifecycle runs before configuration revalidation and collection, chooses a
selection from the complete collected plan, and observes each case through
awaited cleanup. Invocations accept JSON data, a deadline budget, and an explicit
abort signal or `null`. Replies preserve native results, lifecycle data, typed
failures, and deadline status. Failure and timeout replies also retain artifacts
already available to the execution owner. Sessions omit ordinary reporters and disk
persistence. `dispose()` closes admission and awaits active work or owned child
termination.

`Config` describes authored policy. `normalizeConfig` produces a
command-independent `NormalizedConfig` without reading files; `loadConfig`
returns that policy plus `configPath` as `LoadedConfig`. Programmatic commands
accept normalized policy. The old run-prefixed config names are removed.

Configuration loading and authoring are also exposed through
`@overkill-dev/run/config` for packages that need the config-owned surface
without importing orchestration.

`freezePolicy` resolves Node microtest discovery and policy without importing
tests or custom engines. It returns an immutable, serializable
`FrozenMicrotestPolicy` containing the selected profile, loader declarations,
discovered descriptors, baseline request, portable engine, and source identity.
Engine instances and other profile families are unsupported.

Pass `moduleBoundary: null` for ordinary freezing. A `FileModuleBoundary`
contains an absolute `projectRoot` matching discovery and explicit absolute
`sharedRoots` for installed dependencies and runner bootstrap. Shared roots
must not contain the project root. Frozen runner operations enforce this
additional module constraint in both process models, before config revalidation
and through execution cleanup. It does not grant filesystem permissions.
Older serialized policies without this field normalize it to `null`.

`withFileModuleBoundary(boundary, operation)` applies the same constraint to
configuration loading before freezing. Native synchronous module hooks reject
file imports whose real paths escape the allowed roots, including symlink
escapes. Hooks are scoped to the asynchronous operation and removed on success
or failure. A `null` boundary installs no hook. Native module caching remains
unchanged.

`initialize` accepts an ordinary or frozen-policy command and prepares discovery
without importing config again, custom engines, or tests. The selected profile
must use `in-process` execution. Caller bootstrap can run before
`await initialized.collect()`. Collection validates file-backed frozen policy,
imports modules under ordinary runtime policy, and caches either the collected
handle or the failure. Collection failures may expose `RunCollectionError` or
an `AggregateError` containing the original runtime-policy errors.
An initial selection matching no cases rejects collection with
`no-tests-collected`, as `resolve` does.

The collected handle exposes immutable `facts` and a body-free `plan` catalog.
`await collected.run({ selection: { kind: 'all' } })` executes that plan without
reimporting modules. Invocation selection may only narrow the original eligible
cases; seed, shard, order, and policy remain fixed. Empty selection and empty
shards retain ordinary runner semantics. `runWithReporterDelivery` returns the
usual result and reporter-delivery tracking.

Each invocation creates fresh scopes, assertions, cleanup, runtime observers,
reporter instances, and result collection. Observers close before the handle
becomes idle, including on failures. Overlapping invocations of the same handle
reject with `invalid-request`. Module state remains shared between invocations.
Explicit ordinary coverage creates a fresh session and run record each time;
previous collection imports are not repeated for coverage. No disposal call is
required for an idle handle.

Native policy observations follow run and attempt ownership. Runner transport,
lifecycle callbacks, and reporter work do not acquire test-policy attribution.
Unknown observations remain run errors. Late test diagnostics retain their
original identity as attribution drift instead of blaming a later attempt.

Use `source: { kind: 'memory' }` for supplied config, or
`{ kind: 'config-file', request: { cwd, configPath }, resolvedPath }` for loaded
config. `resolvedPath` is the loaded config's `configPath`, including `null` for
the no-config fallback. File-backed policy is revalidated in the execution host
before collection using native module caching. Conflicting effective policy
fails before test imports. Discovery and loader declarations are compared even
when they resolve to the same files. Reporters and unrelated valid profiles are
excluded from the comparison.

`resolve`, `run`, and `runWithReporterDelivery` also accept
`{ kind: 'frozen-policy', policy, invocation: { seed, selection }, reporting }`.
The invocation selection narrows the frozen baseline selection. Supply
`reporting: { reporters, outputRenderer }` explicitly; callbacks and the seed
are excluded from the snapshot. Ordinary runtime guards and process usage policies
still apply. `parseFrozenMicrotestPolicy` validates transported data, including
descriptor roots and file-set ownership, and freezes the result.

The selection, result, and runner-error parsers validate transported values
against the runner's existing schemas. `createRandomRunSeed()` generates a
nonnegative bigint for integrations that resolve a seed before crossing an
execution boundary.

`run` and `runWithReporterDelivery` accept `{ timing: null, signal }` through
`RunInvocationOptions`. A non-null signal requires a `supervised-process` test
profile; other process models reject it before discovery or user imports.
Existing timing-only calls remain valid, and `signal: null` disables cancellation.

Aborting kills the owned test child and awaits shutdown and output draining.
The result retains completed cases and earlier diagnostics, records interrupted
active cases as crashed, and includes an unattributed `crash` runner error.
A pre-aborted invocation imports no tests and starts no child. Abort after child
shutdown has no effect. Hard termination cannot guarantee child-side scope
cleanup. This programmatic interruption is separate from graceful CLI signal
handling. Signals are not part of frozen policy, run facts, or IPC messages.

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
- `commandLineRunner.baseline.update({ cwd, configPath, runRequest })`
- `commandLineRunner.baseline.apply({ cwd, configPath, runRequest })`
- `commandLineRunner.baseline.bootstrap({ cwd, configPath, runRequest })`
- `commandLineRunner.baseline.list({ cwd, configPath, listRequest })`
- `commandLineRunner.baseline.diff({ cwd, configPath, runRequest })`
- `commandLineRunner.bench.runBenchmarks(context)`
- `commandLineRunner.bench.listBenchmarks(context)`
- `commandLineRunner.bench.baseline.update(context)`
- `commandLineRunner.bench.baseline.apply(context)`
- `commandLineRunner.bench.baseline.bootstrap(context)`
- `commandLineRunner.bench.baseline.list(context)`
- `commandLineRunner.bench.baseline.diff(context)`
- `defineConfig(config)`
- `normalizeConfig(config)`
- `loadConfig({ cwd, configPath })`

The binary recognizes `overkill bench run [paths...]` and
`overkill bench list [paths...]`. Run accepts `CommandLineBenchmarkRunRequest`
with `{ cwd, configPath, runRequest }`; list accepts
`CommandLineBenchmarkListRequest` with `{ cwd, configPath, listRequest }`.
Nested requests share the ordinary selection and execution fields, with
`profile: string | null`. An omitted profile selects the sole benchmark profile.
Unknown, missing, ambiguous, or ordinary-family selections return argument error
`3`. Ordinary run/list and direct-file execution reject the benchmark family.

Benchmark profiles use `testFamily: 'benchmark'` in the same registry and support
`execution`, `reporters`, `attachments`, `processUsage`, `timings`,
`timeouts`, and `baselines`. `orchestrator.bench.list(command, { timing: null })` returns a
`ResolvedRun`; `bench.run` and `bench.runWithReporterDelivery` return the regular
result and reporter-delivery shapes. These methods require an explicit profile
in `RunCommand` and explicit invocation timing options. Ordinary methods reject
benchmark profiles before discovery. CLI benchmark commands infer the sole
benchmark profile when `--profile` is omitted.

Benchmark execution supports worker pools and supervised processes. It defaults
to reused workers, file work units, serial scheduling, `maxConcurrency: 1`, and
hedging off. Placement permits parallel lanes for eligible artifact-size
measurements when host calibration allows it; sensitive or unknown work stays
serial. Worker requests remain upper bounds. Concurrent groups and hedging are rejected. Timeout
defaults are collection 5000 ms, soft 40000 ms, and hard 60000 ms; hard overrides
cannot exceed 60000 ms. Resources, runtime descriptors, artifacts, assertion
outcomes, and reporter selection follow the regular runner flow. Listing imports
definitions without executing bodies or acquiring resources. See the
[benchmark guide](../bench/readme.md) for measurement and budget authoring.

`orchestrator.bench.baseline` provides `update`, `apply`, `bootstrap`, `diff`,
and `list`. Execution methods accept a `RunCommand` and explicit timing options;
results include baseline changes and the write outcome. `list` accepts config,
`cwd`, and `{ paths, profile }`, and reads persisted files without importing
benchmarks. See [benchmark baseline commands](../bench/readme.md) for write and
comparison behavior, and [adapter contracts](../baselines/readme.md) for profile
configuration.

`@overkill-dev/run/benchmark-calibration` exposes `calibrateBenchmarkHost` and
`normalizeBenchmarkDuration`, also available from
`@overkill-dev/bench/calibration`. Baseline runs collect real reference samples
in a separate process; adapters choose whether to normalize their observations.

Programmatic microtest requests accept `execution: { mode: 'serial' }` to run
cases serially through cleanup while preserving the selected profile's process
model and other policy. `mode: 'profile-default'` retains configured scheduling.
Serial overrides are rejected for other test families before discovery. The
resolved request records the override; `RunFacts.execution.scheduling` records
effective scheduling while the configured profile stays unchanged. Coverage
remains a separate request field. There is no CLI scheduling override flag.

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
- `workload(name)`
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
workload name, tag, ownership, public runtime key, runtime matrix variant id, runtime
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
Direct
prebuilt `TestPlan` execution belongs to `@overkill-dev/engine` through
`execute(testPlan)`.

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
Native TypeScript coverage uses Node's type stripping and preserves source
offsets. Never-loaded TypeScript files need no generated source maps.
A scope containing no executable sources fails, including scopes matching only
types or no files. Native data is retained on reporting failures. Replay restores
the saved coverage request and resolved profile policy.

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
fail the run. Ordinary on-demand runs without coverage or attachment scopes and
`orchestrator.resolve()` do not create records.

Resolved runtime identities contain selected scenario bindings. They flow into
`RunFacts`, duration-history keys, reporter labels, and artifact IDs so replay
metadata and captured evidence identify the selected scenario.

Process usage measurement is explicit. Project config can enable it under
`profiles.<name>.processUsage.measure`; `RunRequest.measureProcessUsage`
can override that policy for one run. `processUsage.budgets` are thresholds
and require measurement, while `RunRequest.processBudgetOverrides` changes
individual thresholds for one run. CLI commands use the selected profile's
process usage policy.

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
underscores, and hyphens. The name `benchmark` is valid. Profiles declare
`testFamily: 'microtest'`, `'integration'`, or `'benchmark'`; ordinary commands
accept microtest and integration families. The selected
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
timeouts can retry. Cleanup, contract, process-exhaustion, runtime-policy, and crash
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
Direct `NormalizedConfig` values may set `execution.hostProcess` for worker-pool
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
because their writes are intentionally opaque to the dispatcher. Process
exhaustion maps to exit code 5 before generic runner errors because
`process-exhaustion` is also a runner error subtype. Profile reporters replace
top-level project reporters for the selected run; otherwise top-level reporters
are the fallback.
Installing a package does not add commands, and there is no installed-package
scan, dynamic command registry, or command plugin lifecycle.

Project config may set `outputRenderer` to adapt managed line intents, for
example to render GitHub Actions annotations from a brief stdout reporter.
Config files must export `config` as a named export. Default exports are
configuration errors.

Executing benchmark commands collect one host snapshot before collection and
placement. `RunFacts.benchmarkHost` records observations, relative admission
limits, and their results; other families and listing operations use `null`.
`RunFacts.benchmarkPlacement` records the adaptive worker ceiling and its reasons;
it is null for other families. Listing records an uncalibrated one-worker ceiling.
Collector-free artifact-size measurements can use parallel lanes; sensitive or
unknown measurements remain serial. Requested worker and profile caps remain
visible and may be restricted further by calibration. Configured unavailable
signals block execution. See [Host conditions](../bench/readme.md#host-conditions) for limits, formulas, probe availability, and
snapshot timing. Baseline normalization remains in `benchmarkCalibration`.

Built-in timing and CPU metrics normalize automatically. Custom domains select
representative workloads with `calibratedMeasurement`. Calibration is cached within
an execution context; ordinary runs require no captured files. Normalized budgets
and snapshots use a shared reference-workload scale across hardware.

`overkill bench calibrate` optionally captures display references for the selected
benchmark profile. `orchestrator.bench.calibrate(command, { timing: null })` exposes
the same operation. Capture skips benchmark bodies and unrelated fixtures. Reference
files live under the baseline directory's `calibration` subdirectory. Version 4
`benchmark-run` artifacts and `RunFacts.benchmarkNormalization` retain reference
inputs. See the [benchmark guide](../bench/readme.md#calibration-and-normalization)
for scaling, uncertainty, saved expectations, and stale-reference maintenance.

`runCpuCalibrationWorkload()` from `@overkill-dev/run/benchmark-calibration` runs
the fixed integer-mix reference workload and returns its checksum. The built-in
CPU calibration resource measures this same workload.

`readBenchmarkMachine()` reads host identity and metadata without running a
reference workload. `metricReadingSchema` validates metric readings shared by
collectors and persisted samples. Both are exported by
`@overkill-dev/run/benchmark-calibration`.

`benchmarkTimelinePolicySchema`, `benchmarkTimelineEvidenceSchema`, and
`benchmarkTimelineReportSchema` validate timeline policy, retention metadata,
and saved event payloads across benchmark and runner packages.

`serializeRunDiagnostics` projects artifacts, case results, and runner errors
into bounded JSON-safe evidence without writing a run record.
`parseSerializedRunDiagnostics` validates that representation without serializing
its values again.

`createNodeFileStore` provides atomic runtime state writes and create-only
publication, with temporary-file cleanup on failure.

## Ordinary baselines

Configure custom adapters on microtest, property, and integration profiles with `defineBaselineAdapter`,
available from `@overkill-dev/run` and `@overkill-dev/test/config`:

```ts
import { defineBaselineAdapter, defineConfig } from '@overkill-dev/test/config';

const stdout = defineBaselineAdapter<string, string, string>({
    subtype: 'terminal-snapshot',
    comparisonContext: {},
    adapter: {
        id: 'stdout',
        observe({ artifacts }) {
            const text = artifacts
                .flatMap(function captured(artifact) {
                    return artifact.payload.kind === 'captured-output' && artifact.payload.stream === 'stdout'
                        ? [ artifact.payload.text ] :
                        [];
                })
                .join('');
            return { kind: 'observed', value: text };
        },
        propose({ actual }) {
            return actual;
        },
        compare({ actual, expected }) {
            return actual === expected ? { kind: 'match' } : {
                kind: 'mismatch',
                diagnostics: [ { actual, expected, summary: 'stdout changed' } ]
            };
        }
    },
    toComparisonValue(text) {
        return text;
    },
    encode(text) {
        return { kind: 'text', text };
    },
    decode(payload) {
        if (payload.kind !== 'text') {
            throw new TypeError('Expected a text baseline.');
        }
        return payload.text;
    }
});

export const config = defineConfig({
    profiles: {
        integration: {
            testFamily: 'integration',
            files: { include: [ 'source/**/*.integration.test.ts' ] },
            baselines: { adapters: [ stdout ] }
        }
    }
});
```

Callbacks may be asynchronous. `toComparisonValue` converts observations for
comparison; `encode` serializes proposals; `decode` restores comparison values.
Payloads are text or bytes. Adapter IDs are unique within a profile.

`baselines.directory` defaults to `test-baselines`; `baselines.stale` defaults to
`fail` and accepts `warn`. Records use versioned JSON in subtype directories,
with text or base64 payloads. Identity includes profile, adapter, subtype, full
work identity, and comparison context. Performance files retain their existing
format and `overkill bench baseline` namespace.

Use `overkill baseline <verb> --profile <name> [paths...]`:

- `update` creates missing entries and replaces changed entries.
- `apply` also removes stale entries after a complete successful profile inventory.
- `bootstrap` creates missing entries and compares existing entries without replacing them.
- `diff` previews apply changes without writing baselines; changes produce exit code `1`.
- `list` reads persisted identities without collecting tests, observing output, or creating reporters.

Filtered, path-selected, sharded, last-failed, incomplete, and failed runs cannot
remove entries. Skipped cases and foreign scopes are preserved. Entries whose
adapters are unavailable remain inspectable through `list` and are preserved.
Ordinary `run` and replay compare without writing; writes require a baseline verb,
including in CI.

The programmatic equivalents are `orchestrator.baseline.update`, `apply`,
`bootstrap`, `diff`, and `list`. Executing verbs accept a `BaselineCommand` and
`{ timing: null }`; list accepts `{ config, cwd, request: { profile, paths } }`.
`BaselineRunResult` includes changes and the write outcome;
`readOrdinaryBaselineReport(result)` reads the retained report.

Write commands validate the pending batch before publication. Execution,
observation, comparison, or prewrite failures block all changes. Publication is
atomic per file. Later I/O failures retain completed writes and report them;
final reporter failures also preserve completed writes. Built-in snapshot and
visual authoring are separate workflows.

## Run recording

Profiles accept `runRecords: { persist: 'on-demand' | 'always' }`, defaulting to
`on-demand`. Use `overkill run --record` or `RunRequest.record: true` to persist
one invocation. Coverage and resource attachment workflows require records
independently of that default.

Records live at `<runtimeStateDir>/runs/<id>.json`. Explicit recording starts
before runner-owned imports. Artifact-only recording starts after collection
identifies attachment scopes, before resources or cases execute. Reusable
collection is read-only; each execution receives a fresh record ID.

Version 2 records retain a bodyless replay plan and normalized profile policy
alongside resolved facts before execution. They preserve collection counts,
orphan metadata, selected identities, and case controls when execution is
interrupted. Witness replay records retain their concrete input for subsequent replay.
Reporter callbacks come from the current configuration. Version 1
records remain readable by history; records without replay snapshots are unavailable
for replay.

Required write failures fail the command. Completed records include reporter
and cleanup errors; escaping exceptions leave interrupted records.

## Compact history

Persisted runs update run summaries and case outcomes under
`runtimeStateDir/history/index.json`. Duration history remains under
`duration-history/work-durations.json`; ordinary unrecorded runs can warm it.

Top-level `history` config controls `observationsPerIdentity` (20),
`runSummaryLimit` (500), `runSummaryRetentionDays` (90),
`staleIdentityRetentionDays` (90), `lockTimeoutMilliseconds` (5000), and
`staleLockMilliseconds` (120000). Summary count and age limits both apply.
Placement still uses the latest eight duration samples within 30 days.

History is derived state, not a replay source. Interrupted runs do not add
case/work observations. Persistence failures fail the run. History CLI,
`--last-failed` selects the newest failed case outcomes from compact history and
automatically records the run. Combine it with ordinary filters. Valid history
with no matches succeeds without executing cases; missing or corrupt history
requires `overkill history compact`. Programmatic requests use `lastFailed: true`;
ordinary requests use `lastFailed: false`.

### Automatic maintenance

Completed persisted attempts apply retention after reporting, cleanup, and
ownership release. `history.automaticMaintenanceBudgetMilliseconds` defaults to
100; set it to zero to disable automatic maintenance. Explicit commands do not
use this budget. Unrecorded runs do not start maintenance.

The cooperative budget includes lock waiting and scanning. No new operation
starts after the deadline; in-flight filesystem operations finish before the
lock is released and can exceed the budget. Large backlogs may require explicit
`overkill history prune`. Interrupted attempts wait for later maintenance.

Runner returns extend the engine result with `maintenanceDiagnostics`, an array
of messages also printed by the CLI after reporting. These messages never
change verdicts or exit codes. Budget exhaustion, contention, and active runs
quietly defer maintenance. Use `parseRunnerResult` for the extended result;
`parseRunResult` continues to accept the engine-only shape.

### History

`overkill history list` displays persisted run summaries, including summaries
whose detailed records have been pruned. `overkill history compact` rebuilds
history from retained records and reports potential recovery losses.

Use `overkill history prune --dry-run` to preview retention, then
`overkill history prune` to apply it. Global `history.detailedRunLimit`,
`successfulArtifactRunLimit`, and `failingArtifactRetentionDays` default to
20 records, 5 successful artifact runs, and 7 days of unsuccessful artifacts.
Artifacts can survive their detailed record and summary through per-run
retention metadata.

`overkill history clear` asks for confirmation in a terminal; scripts require
`--yes`. It preserves baselines, witnesses, corpus, and unrelated runtime files.
All four commands accept `--config <path>` and operate relative to the current
working directory without discovering or executing tests.

Programmatic callers can use explicit configuration without config loading:

```ts
import { createHistory, normalizeConfig } from '@overkill-dev/run';

const history = createHistory({
    projectRoot: process.cwd(),
    config: normalizeConfig({})
});
await history.list();
await history.prune({ dryRun: true });
await history.compact();
await history.clear({ confirmed: true });
```

Prune, compact, and clear reject active persisted runs. Ownership is registered
before persistence and released after completion or interruption. Do not run
maintenance concurrently with older runner versions lacking ownership tracking.

Successful runs retain their place in the artifact retention window even when
they produced no artifacts and their detailed records and summaries expire.

Pruning preserves detailed records needed to repair incomplete history commits.
Run `overkill history compact` before retrying when pruning reports a repair
requirement. Repair preserves known case outcomes even when a run summary
cannot be recovered.

## Replay

`overkill replay` opens an arrow-key picker over retained replayable records,
including interrupted records with complete facts. Use Enter to select or
choose Cancel. Ctrl+C and EOF also cancel successfully. A dumb terminal uses
a numbered prompt; blank input or `q` cancels.

Without an ID, stdin, stdout, and stderr must be terminals. In scripts, use
`overkill history list` to find an ID and pass `overkill replay <run-id>`.
The picker supports `--config` and uses the configured `runtimeStateDir`.

Replay binds current executable bodies to saved work identities in a fresh
execution host. It restores the saved seed, controls, order, placement, loader,
and profile policy without applying current discovery patterns, filters, shards,
or duration-history scheduling. Missing cases or changed resource descriptors
fail replay. Unavailable runtime variants are inconclusive. Empty selections
require no source imports.

Dynamic runs follow recorded split, batch, hedge, authority, and recovery
decisions. Interrupted traces continue remaining unassigned work in saved lane
order and emit a diagnostic. Replay writes a fresh record and preserves its
source record. Node major differences produce a diagnostic.

`orchestrator.replay({ cwd, config, signal, runId })` returns the current
`RunnerResult`; `replayWithReporterDelivery(...)` also reports runner-error
delivery. Pass `signal: null` when cancellation is unnecessary.

`overkill replay-witness <path> --profile <name>` replays one property or
simulation witness. The corresponding APIs are
`orchestrator.replayWitness({ cwd, config, signal, path, profile })` and
`replayWitnessWithReporterDelivery(...)`. This convenience form requires a profile
and uses a fresh module graph. The request-based form below preserves the selected
profile's process boundaries and supports CLI execution controls.

Property witnesses evaluate the retained input once, bypassing generation,
corpus phases, shrinking, and confirmation. Nested witnesses run the enclosing
case normally and substitute only the named invocation. Missing, ambiguous,
unreached, or incompatible targets fail replay. Simulation witnesses restore
inputs through the resource's `withWitnessReplay` callback and run current
handlers against fresh resources.

## Property corpus storage

Property profiles replay JSON entries named by `corpus.checkedIn`. Paths are
relative to the project root; directories are searched recursively. Missing
paths and incompatible checked-in entries fail. Test execution only writes the
bounded local cache under `runtimeStateDir/corpus`; it never promotes or
migrates repository entries. See the property package's regression corpus
documentation for limits, confirmation, and nested target identity.

### Property corpus

`inspectCorpus`, `promoteWitness`, and `migrateCorpus` operate on versioned property
witness files. Inspection also accepts a local corpus cache index; use a
`cache-entry` source with its entry ID to promote or migrate one cached witness.

```text
overkill corpus inspect witness.json
overkill corpus promote witness.json --to test-corpus/regression.json
overkill corpus inspect .overkill/corpus/<profile-hash>/index.json
overkill corpus promote .overkill/corpus/<profile-hash>/index.json --entry <id> --to test-corpus/regression.json
overkill corpus migrate old.json --to migrated.json
```

Custom inputs require `--codec ./codec.ts`, with a default-exported versioned
codec, or `--codec-export <name>` for a named export. Codec modules run in a
restricted child with a two-second deadline. Operations do not collect or execute
tests and do not discover project configuration.

Promotion preserves input and codec versions. Migration explicitly writes the
current encoding. Both await preview delivery, create a new destination atomically,
and reject existing destinations. Programmatic writers require an asynchronous
`beforeWrite` callback receiving source and output inspections. Previews are bounded
diagnostics; each inspection also retains the complete lossless witness payload.

`@overkill-dev/run/property-codec` exposes `defineCodec`, `capturePropertyInput`,
`decodePropertyInput`, `migratePropertyInput`, and `PropertyCodecError` for shared
lossless input serialization. Property authoring continues to expose `defineCodec`
through `@overkill-dev/property`.

## Witness replay options

`orchestrator.replayWitness(command, { signal: null, timing: null })` accepts a
`ReplayWitnessCommand`. Its `request` contains `path`, `profile` (a name or `null`
for unique property-profile inference), `seed`, `capture`, `record`, and
`timingCollection`. Configuration, working directory, and engine selection use
the same fields as `RunCommand`.

`replayWitnessWithReporterDelivery` additionally reports delivered and undelivered
runner errors. Both operations retain the selected profile's execution boundaries.
Runtime input compatibility and target errors use runner-error subtype
`witness-replay`; ordinary assertions and lifecycle failures retain their outcomes.
Recorded replay facts retain the witness in `propertyReplay`.

The CLI equivalent is `overkill replay-witness <path>` with `--config`, `--profile`,
`--seed`, `--record`, and `--timings`. Property profiles require buffered capture;
`--no-capture` is rejected consistently with ordinary property runs. Simulation
witnesses require an explicit profile and a resource restoration callback.

## Profile adapters

Adapter preparation returns `{ testPlan, collect }`. The collection closure
retains backend inputs while the runner selects executable work. Resolution
collects once, exposes immutable JSON through `RunFacts.adapter`, and retains
the collection for lowering and execution. Reusable invocations collect their
selected subset through the original preparation. Adapter result artifacts
also carry lossless JSON facts; assertion diagnostic budgets do not apply.
