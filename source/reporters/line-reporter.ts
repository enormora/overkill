import kleur from 'kleur';
import figures from 'figures';
import type { CaseId } from '../engine/identity.ts';
import type { RealTimeReporter, ReporterEvent } from '../engine/reporter.ts';
import type { OrphanedNode, RunResult, TestOutcome } from '../engine/run-result.ts';

const successSymbol = kleur.green(figures.tick);
const errorSymbol = kleur.red(figures.cross);
const infoSymbol = kleur.cyan(figures.info);

export type LineReporterDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

function indent(depth: number): string {
    return '  '.repeat(depth);
}

function formatCaseName(id: CaseId): string {
    if (id.params === null) {
        return id.name;
    }

    return `${id.name} [${id.params}]`;
}

function outcomeReason(outcome: TestOutcome): string | null {
    if (outcome.kind === 'fail') {
        return outcome.checks[0]?.summary ?? 'failed';
    }

    if (outcome.kind === 'skip' || outcome.kind === 'inconclusive') {
        return outcome.reason;
    }

    return null;
}

function formatDuration(wallTimeMs: number): string {
    return `${wallTimeMs} ms`;
}

function formatTestResult(id: CaseId, outcome: TestOutcome, wallTimeMs: number): readonly [string, string] {
    const reason = outcomeReason(outcome);
    const detail = reason === null ? '' : `: ${reason}`;
    const message = `${formatCaseName(id)}${detail} (${formatDuration(wallTimeMs)})`;

    if (outcome.kind === 'fail') {
        return [ errorSymbol, message ];
    }

    if (outcome.kind === 'pass') {
        return [ successSymbol, message ];
    }

    return [ infoSymbol, message ];
}

function formatSuiteName(event: Extract<ReporterEvent, { readonly kind: 'suite-start'; }>): string {
    return event.suitePath.at(-1) ?? '<root>';
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
    let suiteDepth = 0;

    function logTestEnd(event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>): void {
        const [ symbol, message ] = formatTestResult(event.case, event.outcome, event.wallTimeMs);

        stdoutConsole.log(symbol, `${indent(suiteDepth)}${message}`);
    }

    function logSuiteStart(event: Extract<ReporterEvent, { readonly kind: 'suite-start'; }>): void {
        stdoutConsole.log(infoSymbol, `${indent(suiteDepth)}${formatSuiteName(event)}`);
        suiteDepth += 1;
    }

    return {
        kind: 'real-time',
        name: 'line',
        sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ],

        async onEvent(event) {
            if (event.kind === 'run-start') {
                stdoutConsole.log(infoSymbol, 'Test run started');
            } else if (event.kind === 'suite-start') {
                logSuiteStart(event);
            } else if (event.kind === 'suite-end') {
                suiteDepth = Math.max(0, suiteDepth - 1);
            } else if (event.kind === 'test-end') {
                logTestEnd(event);
            } else if (event.kind === 'runner-error') {
                stdoutConsole.log(errorSymbol, `Runner error: ${event.error.message}`);
            }
        },

        async onFinish(finalResult) {
            logSummary(stdoutConsole, finalResult);
            logOrphans(stdoutConsole, finalResult.orphans);
        }
    };
}
