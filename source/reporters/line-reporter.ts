import kleur from 'kleur';
import figures from 'figures';
import { formatCaseId, type CaseId } from '../engine/identity.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { OrphanedNode, RunResult, TestOutcome } from '../engine/run-result.ts';

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

function formatOrphan(orphan: OrphanedNode): string {
    return `${orphan.kind}: ${orphan.name} (${orphan.file ?? '<unknown>'})`;
}

function logSummary(stdoutConsole: LineReporterDependencies['stdoutConsole'], result: RunResult): void {
    const { summary } = result;
    stdoutConsole.log(infoSymbol, `Discovered: ${summary.discovered}`);
    stdoutConsole.log(infoSymbol, `Planned: ${summary.planned}`);
    stdoutConsole.log(infoSymbol, `Executed: ${result.perTest.length}`);
    stdoutConsole.log(successSymbol, `Passed: ${summary.passed}`);
    stdoutConsole.log(errorSymbol, `Failed: ${summary.failed}`);
    stdoutConsole.log(infoSymbol, `Skipped: ${summary.skipped}`);
    stdoutConsole.log(infoSymbol, `Inconclusive: ${summary.inconclusive}`);
}

function logOrphans(stdoutConsole: LineReporterDependencies['stdoutConsole'], orphans: readonly OrphanedNode[]): void {
    if (orphans.length === 0) {
        return;
    }

    stdoutConsole.log(infoSymbol, `Orphans: ${orphans.length}`);
    for (const orphan of orphans) {
        stdoutConsole.log(infoSymbol, formatOrphan(orphan));
    }
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
            logSummary(stdoutConsole, finalResult);
            logOrphans(stdoutConsole, finalResult.orphans);
        }
    };
}
