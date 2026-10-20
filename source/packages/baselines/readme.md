# @overkill-dev/baselines

Shared baseline identities, change reports, and performance adapter contracts.
Included in `@overkill-dev/test`; standard users import the types from
`@overkill-dev/test/baselines`.

A `PerformanceBaselineAdapter` has a unique `id` and three synchronous methods:

- `observe({ artifacts, calibration, work })` returns `observed` with a JSON value,
  `not-applicable`, or `missing` with a failure reason.
- `propose({ actual, expected })` returns the expected JSON value to persist.
- `compare({ actual, expected })` returns `match` or `mismatch` with nonempty
  diagnostics containing JSON `actual`, JSON `expected`, and `summary`.

`actual` and `expected` contain `value` and recorded `calibration`. Adapters own
metric extraction, tolerance, and transformations of custom artifacts. Benchmark
sample artifacts arrive normalized when calibration applies. Proposals are stored
with `actual.calibration`; return values expressed in that calibration context.
Storage and command behavior belong to the runner. This package does not collect measurements.

Configure adapters on a benchmark profile:

```ts
export const config = defineConfig({
    profiles: {
        startup: {
            testFamily: 'benchmark',
            files: { include: [ 'source/**/*.bench.ts' ] },
            baselines: { directory: 'test-baselines', adapters: [ durationAdapter ] }
        }
    }
});
```

`directory` defaults to `test-baselines`; `adapters` defaults to `[]`.
Performance JSON files live in its `performance` subdirectory. Each identity
includes profile, adapter, and full work identity. Version 3 normalized expectations
match by calibration workload identity and scaling across machines. Raw and legacy
expectations also include machine class. Other profiles and baseline subtypes
remain separate. Adapters receive normalized `benchmark-samples` when calibration
applies; persisted sample artifacts retain raw values.

## Benchmark chart metadata

Implement `describeMetrics({ actual, expected })` on a
`ChartedPerformanceBaselineAdapter` to declare baseline chart values. Each
metric supplies `name`, `unit`, `scale`, nullable `actual`, and an `expected`
reference tagged `missing`, `value`, or `range`. Raw scales use `{ kind: 'raw' }`;
normalized scales also provide a description. Point references supply `value`;
ranges supply nullable `minimum` and `maximum` with at least one ordered bound.

The adapter owns extraction and normalization. The reporter uses the recorded
comparison outcome and never derives pass/fail from chart values. Existing
adapters need no migration. Invalid chart metadata becomes an infrastructure
error after otherwise valid baseline operations, preserving completed writes.
`readPerformanceBaselineReport(result)` reads current and legacy retained reports.
