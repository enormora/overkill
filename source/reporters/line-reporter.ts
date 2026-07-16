import kleur from 'kleur';
import figures from 'figures';
import { formatCaseId, type CaseId } from '../engine/identity.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { TestOutcome } from '../engine/run-result.ts';

const successSymbol = kleur.green(figures.tick);
const errorSymbol = kleur.red(figures.cross);
const infoSymbol = kleur.cyan(figures.info);

export type LineReporterDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

function formatTestResult(id: CaseId, outcome: TestOutcome): string {
    const formattedId = formatCaseId(id);

    if (outcome.kind === 'fail') {
        return `${errorSymbol} ${formattedId}`;
    }

    if (outcome.kind === 'pass') {
        return `${successSymbol} ${formattedId}`;
    }

    return `${infoSymbol} ${formattedId}`;
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
            stdoutConsole.log(infoSymbol, `Planned: ${summary.planned}`);
            stdoutConsole.log(infoSymbol, `Executed: ${finalResult.perTest.length}`);
            stdoutConsole.log(successSymbol, `Passed: ${summary.passed}`);
            stdoutConsole.log(errorSymbol, `Failed: ${summary.failed}`);
            stdoutConsole.log(infoSymbol, `Skipped: ${summary.skipped}`);
            stdoutConsole.log(infoSymbol, `Inconclusive: ${summary.inconclusive}`);

            if (finalResult.orphans.length > 0) {
                stdoutConsole.log(infoSymbol, `Orphans: ${finalResult.orphans.length}`);
                for (const orphan of finalResult.orphans) {
                    const origin = orphan.file === null ? '<unknown>' : orphan.file;
                    stdoutConsole.log(infoSymbol, `${orphan.kind}: ${orphan.name} (${origin})`);
                }
            }
        }
    };
}
