# `@overkill-dev/reporter-dot`

Compact real-time progress reporter for Overkill test runs.

## API

```ts
import { execute } from '@overkill-dev/engine';
import { createDotReporter } from '@overkill-dev/reporter-dot';

await execute(testPlan, {
    execution: { mode: 'serial-in-process' },
    reporters: [ createDotReporter() ],
    runFacts: {},
    startedAt: new Date().toISOString()
});
```

The reporter writes directly to `stdout` and declares `stdout-raw`.

It prints one mark per completed test and runner error, then a compact
summary and short detail lines for failed tests, inconclusive tests, and
runner errors.
