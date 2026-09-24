import isInteractive from 'is-interactive';
import { createProgressReporter as createProgressReporterInstance } from '../../reporters/progress-reporter.ts';
import type { TerminalOutput } from '../../reporters/terminal.ts';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';

export type ProgressReporterOptions = {
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

export function createProgressReporter(options?: ProgressReporterOptions): DefinedReporter<RealTimeReporter> {
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
