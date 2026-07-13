import type { TestRunResult } from '../engine/test-run-result.ts';
import type { TestCaseResult } from '../engine/test-case-executor.ts';
import type { FinalResultReporter } from '../engine/reporter.ts';

export type TapConsoleReporterDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

function formatTestCaseResultAsTapTestPoint(testCaseResult: TestCaseResult): string {
    const { title, index } = testCaseResult.testCaseDetails;
    let status = 'ok';
    let yamlDiagnostics = '';

    if (testCaseResult.result.status === 'failure') {
        status = 'not ok';
        yamlDiagnostics = `\n  ---\n  reason: ${testCaseResult.result.reason}\n  ...`;
    }

    return `${status} ${index + 1} - ${title}${yamlDiagnostics}`;
}

function formatResultAsTap(testRunResult: TestRunResult): string {
    const version = 'TAP version 14';
    const plan = `1..${testRunResult.summary.totalCount}`;
    const testPoints = testRunResult.testCaseResults.map(formatTestCaseResultAsTapTestPoint);

    return `${version}\n${plan}\n${testPoints.join('\n')}\n`;
}

export function createTapConsoleReporter(dependencies: TapConsoleReporterDependencies): FinalResultReporter {
    const { stdoutConsole } = dependencies;

    return {
        createSession() {
            return {
                async report(currentTestRunResult) {
                    stdoutConsole.log(formatResultAsTap(currentTestRunResult));
                }
            };
        }
    };
}
