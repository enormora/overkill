import { trace } from '@opentelemetry/api';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { createOpenTelemetryReporter as createReporter } from '../../reporters/opentelemetry-reporter.ts';

export function createOpenTelemetryReporter(): DefinedReporter<FinalResultReporter> {
    return createReporter({
        tracer: trace.getTracer('@overkill-dev/reporter-opentelemetry')
    });
}
