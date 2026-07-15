import type { FinalResultReporter } from '../engine/reporter.ts';

export function createNullReporter(): FinalResultReporter {
    return {
        kind: 'final-result',
        name: 'null',
        sinks: [],

        async onResult() {
            return undefined;
        }
    };
}
