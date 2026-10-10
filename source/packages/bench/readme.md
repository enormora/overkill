# @overkill-dev/bench

Ordinary test-node authoring for the Overkill benchmark package.

Included in the standard `@overkill-dev/test` installation. Standard users
import the same authoring surface from `@overkill-dev/test/bench`; advanced
consumers can install and import `@overkill-dev/bench` directly. Bench code
stays outside root `@overkill-dev/test` imports and ordinary microtest startup.

The current facade exports `test`, `skippedTest`, `suite`, `table`,
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

This facade does not yet measure performance. `benchmark(...)`, workloads,
measurement strategies, and budgets are separate implementation milestones.
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
