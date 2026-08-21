import { createLineReporter as createLineReporterInstance } from '../../reporters/line-reporter.ts';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';

export function createLineReporter(): DefinedReporter<RealTimeReporter> {
    return createLineReporterInstance({
        stdoutConsole: console
    });
}
