import { z } from 'zod/v4';
import type { ProcessRequest } from './process-command.ts';
import type { MeasuredProcess } from './process-observation.ts';

export type ProcessInstrumentation = 'node' | 'off';
export type ProcessMeasurementStrategy = {
    readonly mode: 'process';
    readonly instrumentation: ProcessInstrumentation;
};
export type ProcessSample = {
    readonly process: (request: ProcessRequest) => Promise<MeasuredProcess>;
};

type ProcessMeasurementOptions = { readonly instrumentation: ProcessInstrumentation; };
const instrumentationSchema = z.enum([ 'node', 'off' ]);

export function processMeasurement(input: ProcessMeasurementOptions): ProcessMeasurementStrategy {
    return Object.freeze({ mode: 'process', instrumentation: instrumentationSchema.parse(input.instrumentation) });
}
