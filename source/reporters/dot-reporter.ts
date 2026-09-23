import figures from 'figures';
import colors from 'yoctocolors';
import { defineReporter, type DefinedReporter, type RealTimeReporter, type ReporterEvent } from '../engine/reporter.ts';
import type { RunResult, RunnerError, TestVerdict } from '../engine/run-result.ts';
import { formatRunFactSummary } from './run-fact-summary.ts';
import { createTerminalProgressRenderer, type TerminalOutput } from './terminal.ts';
import {
    formatCountSummary,
    formatTimingSummary,
    problemLines
} from './human-reporter-rendering.ts';

export type DotReporterDependencies = {
    readonly interactive: boolean;
    readonly stdout: TerminalOutput;
};

const passMark = colors.green(figures.tick);
const failMark = colors.red(figures.cross);
const skipMark = colors.cyan('°');
const inconclusiveMark = colors.cyan('?');
const runnerErrorMark = colors.red(figures.warning);
const microsecondsPerMillisecond = 1000;

function formatDuration(durationMicroseconds: number): string {
    return `${durationMicroseconds / microsecondsPerMillisecond} ms`;
}

function formatSummary(result: RunResult): string {
    const statusMark = result.status === 'failed' ? failMark : passMark;

    return `${statusMark} ${formatCountSummary(result)} in ${
        formatDuration(result.timings.summary.totalWallTimeMicroseconds)
    } (${formatTimingSummary(result)})`;
}

function markForVerdict(verdict: TestVerdict): string {
    if (verdict === 'resource-exhausted' || verdict === 'crashed') {
        return runnerErrorMark;
    }

    if (verdict === 'fail') {
        return failMark;
    }

    if (verdict === 'pass') {
        return passMark;
    }

    if (verdict === 'skip') {
        return skipMark;
    }

    return inconclusiveMark;
}

function formatRunnerError(error: RunnerError): string {
    return `Runner error: ${error.message}`;
}

export function createDotReporter(dependencies: DotReporterDependencies): DefinedReporter<RealTimeReporter> {
    return defineReporter(function createDotRuntimeReporter(context) {
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
                if (event.kind === 'run-start') {
                    const summary = formatRunFactSummary(event.facts);

                    if (summary !== null) {
                        writeLine(summary);
                    }
                } else if (event.kind === 'test-end') {
                    progress.writeMark(markForVerdict(event.verdict));
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
                const detailLines = problemLines(result, context, { verbose: false });

                for (const detailLine of detailLines) {
                    writeLine(detailLine);
                }
            }
        };
    });
}
