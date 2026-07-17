import { createLineReporter as createLineReporterInstance } from '../../reporters/line-reporter.ts';
import type { RealTimeReporter } from '../engine/engine.entry-point.ts';

export function createLineReporter(): RealTimeReporter {
    return createLineReporterInstance({
        stdoutConsole: console
    });
}
