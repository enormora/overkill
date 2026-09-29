# `@overkill-dev/reporter-opentelemetry`

OpenTelemetry span exporter for Overkill timing data.

Top-level API:

- `createOpenTelemetryReporter()`

Configure an OpenTelemetry SDK before executing the run, then add the reporter:

```ts
import { execute } from '@overkill-dev/engine';
import { createOpenTelemetryReporter } from '@overkill-dev/reporter-opentelemetry';

await execute(testPlan, {
    execution: { mode: 'serial-in-process' },
    reporters: [ createOpenTelemetryReporter() ],
    runFacts: {},
    startedAt: new Date().toISOString()
});
```

The reporter requires precise timing collection. It exports one `overkill.run`
span and one child span for every retained precise timing span. SDK setup,
export transport, flushing, and shutdown remain application responsibilities.
