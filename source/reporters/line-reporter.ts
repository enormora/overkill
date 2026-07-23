import figures from 'figures';
import colors from 'yoctocolors';
import type { CaseId } from '../engine/identity.ts';
import type { RealTimeReporter, ReporterEvent } from '../engine/reporter.ts';
import type { FailOutcome, OrphanedNode, RunResult, TestOutcome } from '../engine/run-result.ts';
import { formatFailure } from './line-failure-rendering.ts';

const successSymbol = colors.green(figures.tick);
const errorSymbol = colors.red(figures.cross);
const infoSymbol = colors.cyan(figures.info);

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

function logFailures(
    stdoutConsole: LineReporterDependencies['stdoutConsole'],
    suiteDepth: number,
    outcome: FailOutcome
): void {
    for (const failure of outcome.failures) {
        for (const line of formatFailure(failure)) {
            stdoutConsole.log(`${indent(suiteDepth + 1)}${line}`);
        }
    }
}

function logSummary(stdoutConsole: LineReporterDependencies['stdoutConsole'], result: RunResult): void {
    const { summary } = result;
    const crashCount = result
        .runnerErrors
        .filter(function isCrash(error) {
            return error.subtype === 'crash';
        })
        .length;
    const executed = summary.passed + summary.failed + summary.skipped + summary.inconclusive + crashCount;
    const outcomes = [
        `${summary.passed} pass`,
        `${summary.failed} fail`,
        `${summary.skipped} skip`,
        ...summary.inconclusive === 0 ? [] : [ `${summary.inconclusive} inconclusive` ],
        ...crashCount === 0 ? [] : [ `${crashCount} crash` ]
    ]
        .join(', ');
    const orphanSummary = result.orphans.length === 0 ? '' : `, ${result.orphans.length} orphaned`;
    const countSummary = `${summary.discovered} discovered, ${summary.planned} planned, ${executed} executed`;

    stdoutConsole.log(
        infoSymbol,
        `${countSummary} (${outcomes})${orphanSummary} in ${formatDuration(result.wallTimeMs)}`
    );
}

function logOrphans(stdoutConsole: LineReporterDependencies['stdoutConsole'], orphans: readonly OrphanedNode[]): void {
    if (orphans.length === 0) {
        return;
    }

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
        if (event.outcome.kind === 'fail') {
            logFailures(stdoutConsole, suiteDepth, event.outcome);
        }
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
