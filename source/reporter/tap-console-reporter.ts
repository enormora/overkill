import type { TestRunResult } from '../test-run-result.js';
import type { TestCaseResult } from '../test-case-executor.js';
import type { FinalResultReporter } from './reporter.js';

export interface TapConsoleReporterDependencies {
    readonly stdoutConsole: Pick<Console, 'log'>;
}

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
                },
            };
        },
    };
}
