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
metric extraction, tolerance, and any explicit normalization. Proposals are stored
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
includes profile, adapter, full work identity, and machine class. Other profiles,
machine classes, and baseline subtypes remain separate.
