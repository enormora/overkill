import figures from 'figures';
import colors from 'yoctocolors';
import { formatCaseId } from '../engine/identity.ts';
import type { RealTimeReporter, ReporterEvent } from '../engine/reporter.ts';
import type { RunResult, RunnerError, TestOutcome } from '../engine/run-result.ts';
import { formatFailureSummary } from './failure-summary.ts';
import { createTerminalProgressRenderer, type TerminalOutput } from './terminal.ts';

export type DotReporterDependencies = {
    readonly interactive: boolean;
    readonly stdout: TerminalOutput;
};

const passMark = colors.green(figures.tick);
const failMark = colors.red(figures.cross);
const skipMark = colors.cyan('°');
const inconclusiveMark = colors.cyan('?');
const runnerErrorMark = colors.red(figures.warning);

function formatDuration(wallTimeMs: number): string {
    return `${wallTimeMs} ms`;
}

function executedCount(result: RunResult): number {
    const { summary } = result;
    const crashCount = result
        .runnerErrors
        .filter(function isCrash(error) {
            return error.subtype === 'crash';
        })
        .length;

    return summary.passed + summary.failed + summary.skipped + summary.inconclusive + crashCount;
}

function formatSummary(result: RunResult): string {
    const { summary } = result;
    const outcomes = [
        `${summary.passed} pass`,
        `${summary.failed} fail`,
        `${summary.skipped} skip`,
        ...summary.inconclusive === 0 ? [] : [ `${summary.inconclusive} inconclusive` ]
    ]
        .join(', ');
    const orphanSummary = result.orphans.length === 0 ? '' : `, ${result.orphans.length} orphaned`;
    const countSummary = [
        `${summary.discovered} discovered`,
        `${summary.planned} planned`,
        `${executedCount(result)} executed`
    ]
        .join(', ');

    return `${countSummary} (${outcomes})${orphanSummary} in ${formatDuration(result.wallTimeMs)}`;
}

function outcomeDetail(outcome: TestOutcome): string | null {
    if (outcome.kind === 'fail') {
        return formatFailureSummary(outcome.failures[0]);
    }

    if (outcome.kind === 'inconclusive') {
        return outcome.reason;
    }

    return null;
}

function markForOutcome(outcome: TestOutcome): string {
    if (outcome.kind === 'pass') {
        return passMark;
    }

    if (outcome.kind === 'fail') {
        return failMark;
    }

    if (outcome.kind === 'skip') {
        return skipMark;
    }

    return inconclusiveMark;
}

function formatRunnerError(error: RunnerError): string {
    return `Runner error: ${error.message}`;
}

function detailLines(result: RunResult): readonly string[] {
    return [
        ...result.perTest.flatMap(function testDetail(testResult) {
            const detail = outcomeDetail(testResult.outcome);

            if (detail === null || testResult.outcome.kind === 'skip') {
                return [];
            }

            const prefix = testResult.outcome.kind === 'fail' ? 'Failed' : 'Inconclusive';

            return [ `${prefix}: ${formatCaseId(testResult.id)}: ${detail}` ];
        }),
        ...result.runnerErrors.map(formatRunnerError)
    ];
}

export function createDotReporter(dependencies: DotReporterDependencies): RealTimeReporter {
    const progress = createTerminalProgressRenderer({
        interactive: dependencies.interactive,
        output: dependencies.stdout
    });
    let finished = false;

    function writeLine(line: string): void {
        dependencies.stdout.write(`${line}\n`);
    }

    function finishProgress(): void {
        if (finished) {
            return;
        }

        finished = true;
        progress.finish();
    }

    return {
        dispose() {
            progress.dispose();
        },
        kind: 'real-time',
        name: 'dot',
        sinks: [ { kind: 'stdout-raw' } ],

        async onEvent(event: ReporterEvent) {
            if (event.kind === 'test-end') {
                progress.writeMark(markForOutcome(event.outcome));
            } else if (event.kind === 'runner-error') {
                if (finished) {
                    writeLine(formatRunnerError(event.error));
                } else {
                    progress.writeMark(runnerErrorMark);
                }
            }
        },

        async onFinish(result: RunResult) {
            finishProgress();
            writeLine(formatSummary(result));
            for (const detailLine of detailLines(result)) {
                writeLine(detailLine);
            }
        }
    };
}
