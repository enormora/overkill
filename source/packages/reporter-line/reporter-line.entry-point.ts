import { createLineReporter as createLineReporterInstance } from '../../reporters/line-reporter.ts';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';

const defaultColumns = 80;

export type LineReporterOptions = {
    readonly color?: boolean;
    readonly verbose: boolean;
    readonly wrap?: boolean;
};

function colorOption(options: LineReporterOptions | undefined): boolean {
    return options?.color ?? true;
}

function wrapOption(options: LineReporterOptions | undefined): boolean {
    return options?.wrap ?? true;
}

function verboseOption(options: LineReporterOptions | undefined): boolean {
    return options?.verbose ?? false;
}

function currentColumns(): number {
    return Number.isSafeInteger(process.stdout.columns) ? process.stdout.columns : defaultColumns;
}

export function createLineReporter(options?: LineReporterOptions): DefinedReporter<RealTimeReporter> {
    return createLineReporterInstance({
        columns: currentColumns(),
        formatOptions: {
            color: colorOption(options),
            wrap: wrapOption(options)
        },
        stdoutConsole: console,
        verbose: verboseOption(options)
    });
}
