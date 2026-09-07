import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { ReporterEvent } from './reporter.ts';
import type { RunnerError } from './run-result.ts';

export type ReporterEventQueue = {
    readonly report: (event: ReporterEvent) => Promise<readonly RunnerError[]>;
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
    reporterDelivery: ReporterDelivery
): ReporterEventQueue {
    let previousReport = Promise.resolve<readonly RunnerError[]>([]);

    return {
        async report(event) {
            const report = (async function reportEventAfterPreviousReport() {
                await waitForPreviousReport(previousReport);

                return await reporterDelivery.reportEvent(event);
            })();
            previousReport = report;

            return await report;
        }
    };
}
