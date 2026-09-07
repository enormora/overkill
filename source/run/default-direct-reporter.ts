import {
    isReporter,
    type DefinedReporter
} from '../engine/reporter.ts';
import { createLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';

export async function createDefaultDirectReporter(): Promise<DefinedReporter> {
    const reporter: unknown = createLineReporter();

    if (!isReporter(reporter)) {
        throw new TypeError('Default line reporter factory returned an invalid reporter.');
    }

    return reporter;
}
