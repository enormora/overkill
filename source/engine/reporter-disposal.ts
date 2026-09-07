import type { RunnerError } from './run-result.ts';

export type ReporterDisposal = {
    readonly disposeOnce: () => Promise<readonly RunnerError[]>;
};

export function createReporterDisposal(
    disposeReporters: () => Promise<readonly RunnerError[]>
): ReporterDisposal {
    let reportersDisposed = false;

    return {
        async disposeOnce() {
            if (reportersDisposed) {
                return [];
            }

            reportersDisposed = true;

            return await disposeReporters();
        }
    };
}
