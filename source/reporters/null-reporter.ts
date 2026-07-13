import { asyncNoop } from 'noop-esm';
import type { FinalResultReporter } from '../engine/reporter.ts';

export function createNullReporter(): FinalResultReporter {
    return {
        createSession() {
            return {
                report: asyncNoop
            };
        }
    };
}
