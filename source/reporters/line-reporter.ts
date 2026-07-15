import kleur from 'kleur';
import figures from 'figures';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { TestOutcome } from '../engine/run-result.ts';

const successSymbol = kleur.green(figures.tick);
const errorSymbol = kleur.red(figures.cross);
const infoSymbol = kleur.cyan(figures.info);

export type LineReporterDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

function formatTestResult(id: string, outcome: TestOutcome): string {
    if (outcome.kind === 'fail') {
        return `${errorSymbol} ${id}`;
    }

    return `${successSymbol} ${id}`;
}

export function createLineReporter(dependencies: LineReporterDependencies): RealTimeReporter {
    const { stdoutConsole } = dependencies;

    return {
        kind: 'real-time',
        name: 'line',
        sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ],

        async onEvent(event) {
            if (event.kind === 'run-start') {
                stdoutConsole.log(infoSymbol, 'Test run started');
            }

            if (event.kind === 'test-end' && event.case !== null && event.outcome !== null) {
                stdoutConsole.log(formatTestResult(event.case, event.outcome));
            }
        },

        async onFinish(finalResult) {
            const { summary } = finalResult;
            stdoutConsole.log(infoSymbol, `Discovered: ${summary.discovered}`);
            stdoutConsole.log(successSymbol, `Passed: ${summary.passed}`);
            stdoutConsole.log(errorSymbol, `Failed: ${summary.failed}`);
        }
    };
}
