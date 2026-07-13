import type { FinalResultReporter } from '../engine/reporter.ts';

export function createNullReporter(): FinalResultReporter {
    return {
        createSession() {
            return {
                async report() {}
            };
        }
    };
}
