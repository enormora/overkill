import { describe, expect, test } from 'tstyche';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { createOpenTelemetryReporter } from './reporter-opentelemetry.entry-point.ts';

describe('createOpenTelemetryReporter', function () {
    test('returns the public final-result reporter contract', function () {
        expect(createOpenTelemetryReporter({ outputFile: 'traces.jsonl' })).type.toBe<
            DefinedReporter<FinalResultReporter>
        >();
    });
});
