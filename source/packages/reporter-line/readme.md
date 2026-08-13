# `@overkill-dev/reporter-line`

Human-readable real-time line reporter for Overkill test runs.

Top-level API:

- `createLineReporter()`

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

The reporter writes to `stdout` and declares that sink as exclusive.

Rendering:

- failed test headers show identity and duration only
- all failure details come from structured `outcome.failures`
- all failed checks are rendered
- run summaries include discovered, planned, executed, pass, fail, and skip
  counts, with inconclusive, crash, and orphan counts only when non-zero
