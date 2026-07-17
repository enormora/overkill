# `@overkill-dev/reporter-line`

Human-readable real-time line reporter for Overkill test runs.

Top-level API:

- `createLineReporter()`

Usage:

```ts
import { execute } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';

await execute(testPlan, {
    reporters: [ createLineReporter() ]
});
```

The reporter writes to `stdout` and declares that sink as exclusive.
