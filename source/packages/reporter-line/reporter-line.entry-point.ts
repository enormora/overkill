import { createLineReporter as createLineReporterInstance } from '../../reporters/line-reporter.ts';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';

export type LineReporterOptions = {
    readonly verbose: boolean;
};

export function createLineReporter(options?: LineReporterOptions): DefinedReporter<RealTimeReporter> {
    return createLineReporterInstance({
        stdoutConsole: console,
        verbose: options?.verbose ?? false
    });
}
