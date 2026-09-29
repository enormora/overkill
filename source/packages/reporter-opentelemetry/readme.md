# `@overkill-dev/reporter-opentelemetry`

OTLP JSON file reporter for Overkill timing data.

Top-level API:

- `createOpenTelemetryReporter()`

Add the final-result reporter with an explicit output file:

```ts
import { execute } from '@overkill-dev/engine';
import { createOpenTelemetryReporter } from '@overkill-dev/reporter-opentelemetry';

await execute(testPlan, {
    execution: { mode: 'serial-in-process' },
    reporters: [
        createOpenTelemetryReporter({
            outputFile: '.overkill/opentelemetry-traces.jsonl'
        })
    ],
    runFacts: {},
    startedAt: new Date().toISOString()
});
```

The reporter requires precise timing collection. It writes one OTLP `TracesData`
JSON object followed by a newline after the run completes, replacing any existing
file. The trace contains one `overkill.run` span and one child span for every
retained precise timing span. Parent directories are created automatically.

The reporter performs no network communication and requires no OpenTelemetry SDK.
