import isInteractive from 'is-interactive';
import { createDotReporter as createDotReporterInstance } from '../../reporters/dot-reporter.ts';
import type { TerminalOutput } from '../../reporters/terminal.ts';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';

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

export function createDotReporter(): DefinedReporter<RealTimeReporter> {
    return createDotReporterInstance({
        interactive: isInteractive({ stream: process.stdout }),
        stdout
    });
}
