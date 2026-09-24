import { createTreeReporter as createTreeReporterInstance } from '../../reporters/tree-reporter.ts';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';

export type TreeReporterOptions = {
    readonly showPassing?: boolean;
    readonly verbose?: boolean;
};

export function createTreeReporter(options?: TreeReporterOptions): DefinedReporter<FinalResultReporter> {
    return createTreeReporterInstance(
        { stdoutConsole: console },
        {
            showPassing: options?.showPassing ?? true,
            verbose: options?.verbose ?? false
        }
    );
}
