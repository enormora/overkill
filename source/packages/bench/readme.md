# @overkill-dev/bench

Ordinary test-node authoring for the Overkill benchmark package.

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
and diagnostic resource usage. List supports locations and orphans.

Benchmarks use the regular resource lifecycle, assertion results, attachments,
and configured reporters. Listing imports definitions but does not run bodies,
acquire resources, instantiate reporters, or write run history.
Execution defaults to a reused worker pool with serial scheduling, one case at
a time, and one executor lane across the run. Worker requests and profile caps
remain visible in execution facts. Supervised execution and fresh workers are
also supported. Hedging and concurrent groups are rejected.
Default timeouts are 5000 ms for collection, 40000 ms soft, and 60000 ms hard.
Overrides must keep soft at or below hard and hard at or below 60000 ms.

This facade does not yet measure performance. The workload model supports the
future `benchmark(title, { workloads, measure, budgets })` API. Measurement
strategies and budgets complete that authoring surface in later milestones.
Advanced authoring and runtime binding remain available from
`@overkill-dev/test` and its resources subpath.

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
