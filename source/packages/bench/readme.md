# @overkill-dev/bench

Workload measurement and performance budgets for Overkill.

Included in the standard `@overkill-dev/test` installation. Standard users
import the same authoring surface from `@overkill-dev/test/bench`; advanced
consumers can install and import `@overkill-dev/bench` directly. Bench code
stays outside root `@overkill-dev/test` imports and ordinary microtest startup.

The current facade exports `workload`, `test`, `skippedTest`, `suite`, `table`,
`defineMacro`, and `defineParameterizedTestBody`. These are the same
family-neutral constructors used by `@overkill-dev/test`, with the same
assertion, validation, and source-location behavior.

```ts
import { suite, test } from '@overkill-dev/bench';

const fixture = { entries: [ 1, 2, 3, 4, 5 ] };

export const testNode = suite('fixture validation', [
    test('contains the expected entries', (scope) => {
        scope.assert.equal(fixture.entries.length, 5);
        return scope.assert.collect();
    })
]);
```

Nodes compose with ordinary `@overkill-dev/test` suites, tables, and macros.
Creating a node does not execute its body or select a test family.

`workload(name, parameters)` snapshots a named JSON parameter record:

```ts
import { workload } from '@overkill-dev/test/bench';

const small = workload('small', { packages: 5 });
```

`small.parameters` preserves inferred fields and is deeply immutable. The
caller-owned input stays mutable. `small.id` is its structured `WorkloadId`;
each parameter is encoded as canonical JSON, so numbers and strings remain
distinct. Names preserve their spelling and reject blank strings and control
characters. Parameters reject lossy values, classes, accessors, cycles,
non-JSON properties, and nesting beyond the shared JSON depth limit of 64.

Advanced DSL authors can pass `{ id: small.id, parameters: small.parameters, body }` entries to
`createWorkloadTestCase` from `@overkill-dev/engine`. It requires at least one
workload and unique workload names. Planning produces one executable `WorkId`
per workload, sharing the logical `CaseId`. Runtime matrices expand each
workload independently. Bodies retain ordinary resource/runtime descriptors.
Use `--filter 'workload=small'` to select a named workload; a case filter
selects every workload of that case.

Resources declare workload dependence with a pure synchronous parser:

```ts
import { defineResource, type WorkloadParameters } from '@overkill-dev/test/resources';

const fixture = defineResource({
    name: 'publish-fixture',
    scope: 'per-case',
    requirements: [],
    dispose: null,
    workload(parameters: WorkloadParameters) {
        if (typeof parameters.packages !== 'number') {
            throw new TypeError('Expected a package count.');
        }
        return { packages: parameters.packages };
    },
    acquire({ workload }) {
        return { packages: workload.parameters.packages };
    }
});
```

`withResource` and `withRuntime` inject handles as usual. Collection and list
validate parsers without acquiring resources. Acquisition and disposal receive
the same parsed value through `context.workload`; independent resources receive
`null`. Direct `startResources` and `startRuntime` sessions accept `workload: small`.
The low-level identity-only `{ id, body }` form remains valid for independent resources.

Workload-dependent resources and their consumers share within their declared
scope and full workload identity. Independent dependencies retain ordinary
sharing across workloads and runtime variants. Scenario bindings, projections,
placement requirements, startup budgets, and attachment attribution use the
existing lifecycle. Executors verify original parameter snapshots against
collection. Equal canonical identities with different original parameters
cannot share a resource boundary.

Advanced DSLs can snapshot inputs with `snapshotWorkloadInput` and
`snapshotWorkloadParameters` from `@overkill-dev/engine`. Descriptor graph
binding uses `createWorkloadResourceBinding`, `bindRuntimeWorkload`, and
`resourceWorkloadIdentity` from `@overkill-dev/resources`.

Public types include `AuthoringAnnotations`, `AuthoringControls`,
`ParameterizedTestScope`, `TableDefinition`, `TableTestBody`, `Suite`,
`Table`, `TestBody`, `TestCase`, `TestNode`, `TestScope`, and
`TestScopeAssertContext`.

The `@overkill-dev/test` binary runs benchmark profiles through
`overkill bench run [paths...]` and lists their resolved plan through
`overkill bench list [paths...]`. Configure a shared project profile:

```ts
export const config = defineConfig({
    profiles: {
        startup: { testFamily: 'benchmark', files: { include: [ 'source/**/*.bench.ts' ] } }
    }
});
```

Omitting `--profile` selects the sole benchmark profile. Missing, ambiguous,
unknown, or ordinary-family selections return argument error `3`.
Both commands accept shared file, title, filter, runtime, order, seed, and shard
selection flags. Run also supports capture, precise timings, worker requests,
and diagnostic process usage. List supports locations and orphans.

Benchmarks use the regular resource lifecycle, assertion results, attachments,
and configured reporters. Listing imports definitions but does not run bodies,
acquire resources, instantiate reporters, or write run history.
Execution defaults to a reused worker pool with serial scheduling within each
worker. Adaptive placement may use multiple lanes for collector-free
`bundle-size` measurements without timing budgets or diagnostics. Other work
resolves one lane. Worker requests and profile caps remain visible in execution
facts. Supervised execution and fresh workers are
also supported. Hedging and concurrent groups are rejected.
Default timeouts are 5000 ms for collection, 40000 ms soft, and 60000 ms hard.
Overrides must keep soft at or below hard and hard at or below 60000 ms.

`benchmark(...)` expands named, immutable JSON workloads before selection and
sharding. Each workload requires at least one metric budget. Return every
metric used by a budget; declare other returned metrics in `diagnosticMetrics`.

```ts
import { benchmark, wallClockMeasurement, workload } from '@overkill-dev/test/bench';

export const testNode = benchmark('serialize', {
    kind: 'runtime',
    workloads: [ workload('small', { entries: 10 }) ],
    measurement: wallClockMeasurement(),
    measure({ workload, sample }) {
        const input = Array.from({ length: workload.parameters.entries }, (_, index) => index);
        const measured = sample.measure(() => JSON.stringify(input));
        return { durationMicroseconds: measured.metrics.durationMicroseconds };
    },
    diagnosticMetrics: [],
    budgets: { small: { durationMicroseconds: { maximum: 100 } } }
});
```

Call `sample.measure(callback)` exactly once per sample, or
`sample.measure(operationCount, callback)` for a known positive integer count.
The result contains the callback's `value` and collector `metrics`, including
`durationMicroseconds` and `operationsPerSecond`. Synchronous callbacks stay
synchronous with synchronous collectors. Async callbacks and async strategies
return a promise which must be awaited. Preparation, collector completion,
resource acquisition, and teardown are outside the measured callback.

`measurementStrategy([...])` accepts synchronous collectors;
`asyncMeasurementStrategy([...])` also accepts asynchronous collectors.
Built-in collectors are `threadCpuCollector`, `processCpuCollector`,
`memoryCollector`, `processResourceCollector`, and `runtimeHealthCollector`.
Runtime health needs an async strategy to prime and drain its observers.
Custom collectors declare identity, metric names, units, and scopes, then
return a session with `start`, `stop`, `complete`, and `dispose`. Start and stop
are synchronous boundaries. Completed readings use `availableMetric` or
`unavailableMetric`. Returned plain numbers are custom metrics with unit `number`.

CPU metrics are deltas in microseconds. Memory metrics include end snapshots
and signed byte deltas; RSS and active resource counts describe the process,
while heap data describes the current thread. Process maximum RSS is a lifetime
high-water mark, not a peak confined to the callback. Page faults, filesystem
operations, and context switches are event counts, not bytes. Unsupported
counters and empty event-loop histograms carry explicit unavailable reasons.
GC observations do not force collection or estimate allocations.

A threshold-only budget measures the median. Set `statistic` to
`{ kind: 'quantile', probability: 0.95 }`,
`{ kind: 'mean', range: { minimum: 0, maximum: 1000 } }`,
`{ kind: 'observed-minimum' }`, or `{ kind: 'observed-maximum' }`.
Supply `minimum`, `maximum`, or both; multiple budgets for one metric use an
array. Bounds are inclusive. Observed extrema describe only this finite run.
Means require finite, ordered bounds with a finite span; observations outside
that declared range invalidate measurement.

Sampling assumes independent, stationary observations. Defaults are 95%
confidence, 5% relative precision, 128 minimum samples, and 65536 maximum samples.
Pass a complete third argument with `annotations`, `controls`, and `sampling`
to override them; `defaultSamplingPolicy` supplies a starting point.
`absolutePrecision` maps metric names to tolerances near zero. Checkpoints grow
geometrically and share error probability across all distinct budgeted targets
and checkpoints within each workload. Quantile estimates use linear interpolation (type 7), with
binomial order-statistic intervals; means use
bounded empirical Bernstein intervals. Diagnostic metrics do not delay stopping.
Measured samples are retained separately from warmup observations.

Warmup runs automatically: 32 invocations of the same `measure(...)` callback
precede measured sampling for each workload and runtime variant. No additional
authoring is required. Warmup uses the same resources, collectors, and sample
cleanup, but its readings never contribute to measured counts, intervals, or
budgets. A fixed count does not establish optimization or statistical stationarity.

The third argument accepts `lifecycle` alongside `annotations`, `controls`,
and `sampling`. Existing options without `lifecycle` use
`defaultBenchmarkLifecyclePolicy`. Set `lifecycle.warmupSamples` to zero for
cold-start measurements; counts from zero through 65536 are supported.

Register invocation-owned resets with `sample.cleanup(callback)`. Callbacks
may be synchronous or asynchronous, run in reverse order after every warmup
or measured invocation, and finish before the next invocation. They also run
when preparation, measurement, or metric validation fails. Registration after
cleanup starts is rejected. Preparation, cleanup, and cooldown remain outside
`sample.measure(...)`. `context.cleanup(...)` keeps its attempt lifetime and
runs after the attempt signal is aborted. Sample cleanup runs while that
signal remains live unless the attempt has already been cancelled.

Cooldown is off by default. Set `lifecycle.cooldown` to
`defaultRuntimeCooldownPolicy` to wait for two consecutive 50 ms windows with
event-loop utilization at most 10%, bounded by 1000 ms. Explicit runtime
policies configure `maximumEventLoopUtilization` in `[0, 1]` and
`timeoutMilliseconds` above 100 ms and at most 60000 ms. Busy windows reset the
consecutive count. Cooldown runs after each successful invocation's cleanup,
including the final invocation, and stops on case cancellation. It observes
the executing event loop rather than host-wide CPU, memory, or thermal state.

A budget passes when its interval is wholly inside its bounds, fails when the
interval establishes a violation, and continues sampling while it overlaps a
threshold. Every inferential target must also meet precision. Missing or
unavailable budgeted metrics fail normally. Unresolved intervals or precision
at the sample limit produce an incomplete result and a measurement error,
preserving established failures. The existing case timeout also applies.

Resource and runtime wrappers surround the entire sampling session, so fixtures
are acquired once per attempt, surrounding warmup and measured sampling.
Attempt cleanup callbacks run after the attempt.
`workload: parseParameters` opts a resource into workload-specific acquisition
and cache identity. Acquisition and disposal receive parsed parameters and
identity through `context.workload`; independent resources receive `null` and
keep their existing sharing rules. Runtime matrices multiply the workload plan.
For TypeScript resource/runtime wrappers, pass
`BenchmarkMeasureContext<Parameters>` as `Scope` and `BenchmarkMetrics` (or a
narrower metric object) as `Result`. Wrapper defaults describe ordinary assertions.

Results and attempts contain nullable `benchmark` summaries with policy,
sample count, metric provenance, budget estimates, intervals, and decisions.
Reporters receive `benchmark-progress` and the final summary on `test-end`.
Raw readings use bounded `benchmark-samples` attachments, with explicit omission
when retention limits or a missing attachment coordinator prevent recording.
Versioned `lifecycle` evidence records warmup counts and summaries, sample
cleanup counts and failures, and runtime cooldown observations. Warmup readings
use separate `benchmark-warmup-samples` attachments under the same retention
limits. Completed readings survive cleanup or cooldown failure; sampling stops
with incomplete evidence and failures block baseline writes. Cooperative
interruptions retain confirmed prefixes; hard termination retains the last
delivered progress snapshot. Historical results without lifecycle evidence
decode it as `null`.

External-process measurement and browser collectors remain later milestones.
Benchmark HTML reports show warmup and lifecycle evidence separately from
measured distributions and budgets, and are available through
`createBenchmarkHtmlReporter` from `@overkill-dev/test/reporters`.

Performance baseline commands use adapters configured in the benchmark profile:

| Command                             | Behavior                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `overkill bench baseline update`    | Create missing expectations and replace changed expectations.                                           |
| `overkill bench baseline apply`     | Update expectations and remove stale expectations after a complete successful inventory.                |
| `overkill bench baseline bootstrap` | Create missing expectations; compare and preserve existing expectations.                                |
| `overkill bench baseline diff`      | Preview apply changes without writing baselines; exit `1` for any change.                               |
| `overkill bench baseline list`      | List persisted expectations across machine classes without importing benchmarks or running calibration. |

Execution verbs accept the same selection flags as `bench run`. List accepts
paths, `--profile`, and `--config`. Ordinary `bench run` compares expectations
without writing them. Comparison failures exit `1`; storage, observation, or
calibration failures exit `2`. Explicit writes are permitted in CI.

Writes begin only after all selected cases and observations succeed. Bootstrap
comparison failures block every write. Filtered or sharded apply runs preserve
stale files; complete apply preserves skipped cases and other machine classes.
Update and bootstrap fail on stale expectations in a complete inventory.
Each file is written atomically. A later write or reporter failure preserves
already completed writes, recorded in the run's `performance-baselines` JSON
attachment and the programmatic command result.

Runs using performance baselines perform a real CPU reference calibration in a
separate process with the benchmark Node arguments and sanitized environment.
Recorded metadata identifies the machine class and preserves reference samples.
Cross-class comparison has no fallback. Calibration does not itself normalize
observations. An adapter can explicitly use `normalizeBenchmarkDuration` from
`@overkill-dev/bench/calibration` for CPU duration metrics; unsuitable metrics
should retain their own comparison policy.

## Host conditions

Every executing benchmark run records a host snapshot before collection and
placement. `bench list` and baseline `list` do not collect host observations.
The snapshot records capacity, load, memory availability, Node/V8 versions,
OS details, and available platform pressure signals. Every reading identifies
its source, scope, unit, and availability. Free memory is not memory pressure.

Benchmark profiles may reject known-bad conditions with relative limits:

```ts
host: {
    limits: {
        maximumCpuBusyPercent: 80,
        minimumAvailableMemoryPercent: 10
    }
}
```

Limits default to `null`, disabling each check. Equality passes. A violated
limit or an unavailable configured signal stops the run before collection,
resources, samples, or baseline writes, with a `measurement` runner error.
Unconfigured unavailable signals remain diagnostic. There is no automatic retry.

| Limit                              | Percentage meaning                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `maximumCpuBusyPercent`            | Busy CPU-time delta divided by total CPU-time delta across visible logical CPUs                          |
| `maximumHostLoadPerCpuPercent`     | One-minute host load divided by visible logical CPU count, multiplied by 100; may exceed 100             |
| `minimumAvailableMemoryPercent`    | Process-available bytes divided by the smaller known physical/process memory capacity, multiplied by 100 |
| `maximumLinuxCpuStallPercent`      | Linux CPU PSI `some.avg10`                                                                               |
| `maximumLinuxMemoryStallPercent`   | Linux memory PSI `some.avg10`                                                                            |
| `maximumLinuxIoStallPercent`       | Linux I/O PSI `some.avg10`                                                                               |
| `minimumDarwinCpuSpeedPercent`     | Darwin CPU speed limit                                                                                   |
| `minimumDarwinCpuSchedulerPercent` | Darwin CPU scheduler limit                                                                               |

Percentages must be finite and between 0 and 100, except host load, which has
no upper bound. Unknown process memory constraints use physical capacity as
the denominator and retain the unknown constraint reading. Available parallelism
is recorded separately from logical CPU count; host load does not claim to
measure container CPU utilization. Windows load average is unavailable.

Linux reads `/proc/pressure/{cpu,memory,io}`. Darwin uses read-only
`sysctl -n kern.memorystatus_vm_pressure_level` and `pmset -g therm` probes.
Missing tools, denied access, malformed data, and timeouts are explicit.
Other platforms retain portable observations and unsupported signal states.

The observer uses a 250 ms window. The complete pass has a 1000 ms deadline,
reduced by a shorter collection timeout; platform probes have a 250 ms deadline
within that cap. Incomplete windows have unavailable CPU-busy readings.
Observers and probes stop before execution. Runtime-health and process metrics
describe the runner process, not a workload's executing runtime. Node arguments
in the snapshot belong to that observer; execution host arguments retain their
ordinary execution facts.

`RunFacts.benchmarkHost` contains the snapshot, configured limits, and check
results. Version 3 `benchmark-run` artifacts retain host evidence and the nullable
`placement` decision for JSON and HTML reporting, including rejected runs.
Versions 1 and 2 remain readable with `placement: null`; version 1 also uses
`host: null`. Host observations are separate from
`RunFacts.benchmarkCalibration`, which retains CPU normalization references.
The snapshot describes its recorded moment; collection and fixture startup may
change conditions afterward. Sampling does not recheck host conditions.

### Adaptive placement

`RunFacts.benchmarkPlacement` records policy `conservative-size-only-v1`,
`maximumWorkers`, and bounded `limits` with reason and ceiling pairs. Custom
returned metrics in `bundle-size` benchmarks are trusted to describe artifact
sizes; no unit declaration or new authoring option is needed. Any collector,
timing metric budget/diagnostic, other kind, or missing metadata makes the
selected run serial. Filtering and sharding happen before this decision.

Host capacity can reduce the ceiling further. The runner reserves one CPU and
subtracts the larger of observed busy CPU equivalents and available one-minute
load. Missing required evidence, zero available memory, native Linux stalls,
or Darwin CPU throttling resolve one worker. Existing opt-in host limits still
block rejected hosts. Ordinary worker and resource caps remain authoritative.
See [Execution Strategy](../../../documentation/desired-concept/authoring/benchmarking.md#execution-strategy)
for the exact formula and signal policy.

Listing does not observe the host and records an uncalibrated one-worker cap.
Supervised runs stay serial. Incompatible mixed worker lifecycles remain plan
errors. Placement is frozen before samples; host conditions are not rechecked.
