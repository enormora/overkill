import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { RunnerError } from './run-result.ts';

export async function reportRunnerErrorEvents(
    reporterDelivery: ReporterDelivery,
    runnerErrors: readonly RunnerError[]
): Promise<readonly RunnerError[]> {
    let reporterErrors: readonly RunnerError[] = [];

    for (const error of runnerErrors) {
        reporterErrors = [
            ...reporterErrors,
            ...await reporterDelivery.reportEvent({
                error,
                kind: 'runner-error'
            })
        ];
    }

    return reporterErrors;
}

export async function reportRunnerErrors(
    reporterDelivery: ReporterDelivery,
    runnerErrors: readonly RunnerError[]
): Promise<readonly RunnerError[]> {
    if (runnerErrors.length === 0) {
        return [];
    }

    return [
        ...runnerErrors,
        ...await reportRunnerErrorEvents(reporterDelivery, runnerErrors)
    ];
}

export function unreportedRunnerErrors(
    runnerErrors: readonly RunnerError[],
    reportedRunnerErrors: readonly RunnerError[]
): readonly RunnerError[] {
    const reported = new Set(reportedRunnerErrors);

    return runnerErrors.filter(function wasNotReported(runnerError) {
        return !reported.has(runnerError);
    });
}
