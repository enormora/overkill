import ansiEscapes from 'ansi-escapes';
import figures from 'figures';
import colors from 'yoctocolors';
import { defineReporter, type DefinedReporter, type RealTimeReporter, type ReporterEvent } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { TerminalOutput } from './terminal.ts';
import { treeResultLines, type TreeReporterOptions } from './tree-reporter.ts';

export type ProgressReporterDependencies = {
    readonly interactive: boolean;
    readonly stdout: TerminalOutput;
};

export type ProgressReporterOptions = TreeReporterOptions;

type ProgressState = {
    readonly completed: number;
    readonly failed: number;
    readonly planned: number | null;
};

function readPlannedCount(event: Extract<ReporterEvent, { readonly kind: 'run-start'; }>): number | null {
    const { cases } = event.facts;

    return Array.isArray(cases) ? cases.length : null;
}

function progressText(state: ProgressState): string {
    const planned = state.planned === null ? '?' : String(state.planned);
    const width = 20;
    const filled = state.planned === null || state.planned === 0
        ? 0
        : Math.min(width, Math.round(width * state.completed / state.planned));
    const bar = `${'='.repeat(filled)}${'.'.repeat(width - filled)}`;

    return `[${bar}] ${state.completed}/${planned} failed=${state.failed}`;
}

function updateState(
    state: ProgressState,
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>
): ProgressState {
    return {
        completed: state.completed + 1,
        failed: event.verdict === 'pass' || event.verdict === 'skip' ? state.failed : state.failed + 1,
        planned: state.planned
    };
}

function runnerErrorLine(event: Extract<ReporterEvent, { readonly kind: 'runner-error'; }>): string {
    return `${colors.red(figures.warning)} Runner error: ${event.error.message}`;
}

export function createProgressReporter(
    dependencies: ProgressReporterDependencies,
    options: ProgressReporterOptions
): DefinedReporter<RealTimeReporter> {
    return defineReporter(function createProgressRuntimeReporter(context) {
        let state: ProgressState = {
            completed: 0,
            failed: 0,
            planned: null
        };
        let renderedProgress = false;

        function writeLine(line: string): void {
            dependencies.stdout.write(`${line}\n`);
        }

        function renderProgress(): void {
            if (!dependencies.interactive) {
                return;
            }

            const prefix = renderedProgress ? ansiEscapes.eraseLines(1) : '';
            dependencies.stdout.write(`${prefix}${progressText(state)}`);
            renderedProgress = true;
        }

        function clearProgress(): void {
            if (dependencies.interactive && renderedProgress) {
                dependencies.stdout.write(ansiEscapes.eraseLines(1));
            }
            renderedProgress = false;
        }

        return {
            dispose: null,
            kind: 'real-time',
            name: 'progress',
            sinks: [ { kind: 'stdout-raw' } ],

            onEvent(event) {
                if (event.kind === 'run-start') {
                    state = { completed: 0, failed: 0, planned: readPlannedCount(event) };
                    renderProgress();
                } else if (event.kind === 'test-end') {
                    state = updateState(state, event);
                    renderProgress();
                } else if (event.kind === 'runner-error' && !dependencies.interactive) {
                    writeLine(runnerErrorLine(event));
                }
            },

            onFinish(result: RunResult) {
                clearProgress();
                for (const line of treeResultLines(result, context, options)) {
                    writeLine(line);
                }
            }
        };
    });
}
