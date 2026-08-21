import { defineReporter, type DefinedReporter, type FinalResultReporter } from '../engine/reporter.ts';

export function createNullReporter(): DefinedReporter<FinalResultReporter> {
    return defineReporter({
        dispose: null,
        kind: 'final-result',
        name: 'null',
        sinks: [],

        async onResult() {
            return undefined;
        }
    });
}
