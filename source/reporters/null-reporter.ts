import type { FinalResultReporter } from '../engine/reporter.ts';

export function createNullReporter(): FinalResultReporter {
    return {
        dispose: null,
        kind: 'final-result',
        name: 'null',
        sinks: [],

        async onResult() {
            return undefined;
        }
    };
}
