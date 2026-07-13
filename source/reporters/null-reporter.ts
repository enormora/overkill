import type { FinalResultReporter } from '../engine/reporter.js';

export function createNullReporter(): FinalResultReporter {
    return {
        createSession() {
            return {
                async report() {}
            };
        }
    };
}
