import type { PerTestResult, RunResult } from '../engine/run-result.ts';
import type { FinalResultReporter } from '../engine/reporter.ts';

export type TapConsoleReporterDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

function formatTestCaseResultAsTapTestPoint(testCaseResult: PerTestResult, index: number): string {
    let status = 'ok';
    let yamlDiagnostics = '';

    if (testCaseResult.outcome.kind === 'fail') {
        status = 'not ok';
        yamlDiagnostics = `\n  ---\n  reason: ${testCaseResult.outcome.checks[0]?.summary ?? 'failed'}\n  ...`;
    }

    return `${status} ${index + 1} - ${testCaseResult.id}${yamlDiagnostics}`;
}

function formatResultAsTap(testRunResult: RunResult): string {
    const version = 'TAP version 14';
    const plan = `1..${testRunResult.summary.discovered}`;
    const testPoints = testRunResult.perTest.map(formatTestCaseResultAsTapTestPoint);

    return `${version}\n${plan}\n${testPoints.join('\n')}\n`;
}

export function createTapConsoleReporter(dependencies: TapConsoleReporterDependencies): FinalResultReporter {
    const { stdoutConsole } = dependencies;

    return {
        kind: 'final-result',
        name: 'tap',
        sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ],

        async onResult(currentTestRunResult) {
            stdoutConsole.log(formatResultAsTap(currentTestRunResult));
        }
    };
}
