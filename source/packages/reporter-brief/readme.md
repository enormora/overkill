# `@overkill-dev/reporter-brief`

Token-conscious managed stdout reporter for Overkill test runs.

```ts
import { createPlainOutputRenderer, execute } from '@overkill-dev/engine';
import { createBriefReporter } from '@overkill-dev/reporter-brief';

await execute(testPlan, {
    execution: { mode: 'serial-in-process' },
    outputRenderer: createPlainOutputRenderer(),
    reporters: [ createBriefReporter() ],
    runFacts: {},
    startedAt: new Date().toISOString()
});
```

The reporter declares `stdout-managed-primary`. It emits run start, sparse
progress, failed-test causes, runner errors, and final counts. It does not emit
ANSI color, cursor control, or passing test lines.
