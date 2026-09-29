# `@overkill-dev/reporter-line`

Human-readable line reporter family for Overkill test runs.

Top-level API:

- `createLineReporter()`
- `createLineTreeReporter()`
- `createLineProgressReporter()`

Usage:

```ts
import { execute } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';

await execute(testPlan, {
    execution: { mode: 'serial-in-process' },
    reporters: [ createLineReporter() ],
    runFacts: {},
    startedAt: new Date().toISOString()
});
```

The reporter writes directly to `stdout` and declares `stdout-raw`.

`createLineReporter()` emits completed tests in completion order.
`createLineTreeReporter()` prints the logical result tree after the run.
`createLineProgressReporter()` shows compact live progress, then prints the
same logical result tree.

Rendering:

- failed test headers show identity and duration only
- all failure details come from structured `outcome.failures`
- all failed checks are rendered
- failed checks include source locations when available, including forwarding
  details when a check carries more than one location
- run summaries include discovered, planned, executed, pass, fail, and skip
  counts, with inconclusive, crash, and orphan counts only when non-zero
- precise timing summaries list up to five runner overhead spans above 500 ms
