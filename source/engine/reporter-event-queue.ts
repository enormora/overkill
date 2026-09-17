import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { ReporterEvent } from './reporter.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

export type ReporterEventQueue = {
    readonly report: (event: ReporterEvent) => Promise<readonly RunnerError[]>;
};

function commonSuitePrefixLength(
    firstSuitePath: TestPlanCase['suitePath'],
    secondSuitePath: TestPlanCase['suitePath']
): number {
    const shortestLength = Math.min(firstSuitePath.length, secondSuitePath.length);
    let prefixLength = 0;

    while (
        prefixLength < shortestLength &&
        firstSuitePath[prefixLength]?.title === secondSuitePath[prefixLength]?.title
    ) {
        prefixLength += 1;
    }

    return prefixLength;
}

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

export async function reportSuiteTransition(
    reporterDelivery: ReporterDelivery,
    currentSuitePath: TestPlanCase['suitePath'],
    nextSuitePath: TestPlanCase['suitePath']
): Promise<readonly RunnerError[]> {
    let reporterErrors: readonly RunnerError[] = [];
    const sharedPrefixLength = commonSuitePrefixLength(currentSuitePath, nextSuitePath);

    for (let pathLength = currentSuitePath.length; pathLength > sharedPrefixLength; pathLength -= 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await reporterDelivery.reportEvent({
                kind: 'suite-end',
                suitePath: currentSuitePath.slice(0, pathLength)
            })
        ];
    }

    for (let pathLength = sharedPrefixLength + 1; pathLength <= nextSuitePath.length; pathLength += 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await reporterDelivery.reportEvent({
                kind: 'suite-start',
                suitePath: nextSuitePath.slice(0, pathLength)
            })
        ];
    }

    return reporterErrors;
}
