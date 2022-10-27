import type { TestCaseResult } from '../test-case-executor.js';
import type { RealTimeReporter } from './reporter.js';
import kleur from 'kleur';
import figures from 'figures';

const successSymbol = kleur.green(figures.tick);
const errorSymbol = kleur.red(figures.cross);
const infoSymbol = kleur.cyan(figures.info);

export interface LineReporterDependencies {
    readonly stdoutConsole: Pick<Console, 'log'>;
}

function formatTestResult(testCaseResult: TestCaseResult): string {
    if (testCaseResult.result.status === 'failure') {
        return `${errorSymbol} ${testCaseResult.testCaseDetails.title}`;
    }

    return `${successSymbol} ${testCaseResult.testCaseDetails.title}`;
}

export function createLineReporter(dependencies: LineReporterDependencies): RealTimeReporter {
    const { stdoutConsole } = dependencies;

    return {
        createSession() {
            return {
                async start(currentSuiteResult) {
                    const { summary } = currentSuiteResult;
                    stdoutConsole.log(
                        infoSymbol,
                        `Test run started (${summary.completedCount} / ${summary.totalCount})`,
                    );
                },

                async progress(_currentSuiteResult, testCaseResult) {
                    stdoutConsole.log(formatTestResult(testCaseResult));
                },

                async done(finalResult) {
                    const { summary } = finalResult;
                    stdoutConsole.log(infoSymbol, `Total: ${summary.totalCount}`);
                    stdoutConsole.log(successSymbol, `Succeeded: ${summary.successCount}`);
                    stdoutConsole.log(errorSymbol, `Failed: ${summary.failedCount}`);
                },
            };
        },
    };
}
