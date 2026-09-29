import isInteractive from 'is-interactive';
import { createLineReporter as createLineReporterInstance } from '../../reporters/line-reporter.ts';
import { createProgressReporter as createProgressReporterInstance } from '../../reporters/progress-reporter.ts';
import type { TerminalOutput } from '../../reporters/terminal.ts';
import { createTreeReporter as createTreeReporterInstance } from '../../reporters/tree-reporter.ts';
import type { DefinedReporter, FinalResultReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';

const defaultColumns = 80;

export type LineReporterOptions = {
    readonly color?: boolean;
    readonly verbose: boolean;
    readonly wrap?: boolean;
};

export type LineProgressReporterOptions = {
    readonly showPassing?: boolean;
    readonly verbose?: boolean;
};

export type LineTreeReporterOptions = {
    readonly showPassing?: boolean;
    readonly verbose?: boolean;
};

const stdout: TerminalOutput = {
    get columns() {
        return process.stdout.columns;
    },
    off(event, listener) {
        return process.stdout.off(event, listener);
    },
    on(event, listener) {
        return process.stdout.on(event, listener);
    },
    write(text) {
        return process.stdout.write(text);
    }
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

export function createLineProgressReporter(
    options?: LineProgressReporterOptions
): DefinedReporter<RealTimeReporter> {
    return createProgressReporterInstance(
        {
            interactive: isInteractive({ stream: process.stdout }),
            stdout
        },
        {
            showPassing: options?.showPassing ?? true,
            verbose: options?.verbose ?? false
        }
    );
}

export function createLineTreeReporter(
    options?: LineTreeReporterOptions
): DefinedReporter<FinalResultReporter> {
    return createTreeReporterInstance(
        { stdoutConsole: console },
        {
            showPassing: options?.showPassing ?? true,
            verbose: options?.verbose ?? false
        }
    );
}
