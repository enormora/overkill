import type { OutputRenderer } from './reporter-output.ts';
import type { ReporterDispatcher } from './reporter-dispatcher.ts';
import type { Reporter, ReporterEvent } from './reporter.ts';
import type { RunnerError } from './run-result.ts';

export type ReporterEventQueue = {
    readonly report: (event: ReporterEvent) => Promise<readonly RunnerError[]>;
};

type ReporterEventQueueDependencies = {
    readonly reporterDispatcher: ReporterDispatcher;
};

async function waitForPreviousReport(previousReport: Promise<readonly RunnerError[]>): Promise<void> {
    try {
        await previousReport;
    } catch {
        return undefined;
    }

    return undefined;
}

export function createReporterEventQueue(
    reporters: readonly Reporter[],
    outputRenderer: OutputRenderer,
    dependencies: ReporterEventQueueDependencies
): ReporterEventQueue {
    let previousReport = Promise.resolve<readonly RunnerError[]>([]);

    return {
        async report(event) {
            const report = (async function reportEventAfterPreviousReport() {
                await waitForPreviousReport(previousReport);

                return await dependencies.reporterDispatcher.reportEvent(reporters, event, outputRenderer);
            })();
            previousReport = report;

            return await report;
        }
    };
}
