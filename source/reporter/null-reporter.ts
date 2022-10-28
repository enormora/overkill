import type { FinalResultReporter } from './reporter.js';

export function createNullReporter(): FinalResultReporter {
    return {
        createSession() {
            return {
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                async report() {},
            };
        },
    };
}
