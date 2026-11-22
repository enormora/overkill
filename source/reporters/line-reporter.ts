import figures from 'figures';
import colors from 'yoctocolors';
import { defineReporter, type DefinedReporter, type RealTimeReporter, type ReporterEvent } from '../engine/reporter.ts';
import {
    formatDefinitionLocations,
    type ReportingContext
} from '../engine/reporting-context.ts';
import type {
    OrphanedNode,
    RunResult,
    TestFailure,
    TestOutcome,
    TestVerdict
} from '../engine/run-result.ts';
import { formatFailureSummary } from './failure-summary.ts';
import { formatFailureLocation } from './line-failure-rendering.ts';
import {
    formatCoverageSummaryLines,
    formatDuration,
    formatRunFactSummary,
    formatTimingOffenderLines
} from './run-summary-rendering.ts';
import { createTerminalLineLogger, type TerminalLineLogger, visibleTerminalWidth } from './terminal.ts';
import {
    contextPrefix,
    formatDebugSummary,
    formatLineExecutionCounts,
    formatLineVerdicts,
    problemLines,
    type HumanReporterFormatOptions
} from './human-reporter-rendering.ts';

const successSymbol = colors.green(figures.tick);
const errorSymbol = colors.red(figures.cross);
const infoSymbol = colors.cyan(figures.info);
const minimumColumnWidth = 1;
const minimumDurationGap = 2;
const progressInterval = 100;

type TestEndEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;

type WrapTextState = {
    readonly lines: readonly string[];
    readonly line: string;
};

export type LineReporterDependencies = {
    readonly columns: number;
    readonly formatOptions: HumanReporterFormatOptions;
    readonly interactive: boolean;
    readonly showPassing: boolean;
    readonly stdoutConsole: Pick<typeof console, 'log'>;
    readonly verbose: boolean;
};

function indent(depth: number): string {
    return '  '.repeat(depth);
}

function outcomeReason(outcome: TestOutcome): string | null {
    if (outcome.kind === 'skip' || outcome.kind === 'inconclusive') {
        return outcome.reason;
    }

    return null;
}

function nextWrapTextState(state: WrapTextState, word: string, textColumns: number): WrapTextState {
    const candidate = state.line.length === 0 ? word : `${state.line} ${word}`;

    if (state.line.length > 0 && visibleTerminalWidth(candidate) > textColumns) {
        return { line: word, lines: [ ...state.lines, state.line ] };
    }

    return { ...state, line: candidate };
}

function wrapTextParts(value: string, columns: number): readonly string[] {
    const leadingWhitespace = /^\s*/u.exec(value)?.[0] ?? '';
    const text = value.slice(leadingWhitespace.length);
    const textColumns = Math.max(minimumColumnWidth, columns - visibleTerminalWidth(leadingWhitespace));
    const initialState: WrapTextState = { line: '', lines: [] };
    const state = text
        .split(' ')
        .reduce(function wrapWord(currentState, word) {
            return nextWrapTextState(currentState, word, textColumns);
        }, initialState);

    return [ ...state.lines, state.line ].map(function indentWrappedLine(wrappedLine) {
        return `${leadingWhitespace}${wrappedLine}`;
    });
}

function wrapText(value: string, columns: number): readonly string[] {
    if (visibleTerminalWidth(value) <= columns) {
        return [ value ];
    }

    return wrapTextParts(value, columns);
}

function logSingleValueLine(terminal: TerminalLineLogger, columns: number, value: string): void {
    const lines = wrapText(value, Math.max(minimumColumnWidth, columns));

    for (const line of lines) {
        terminal.line(line);
    }
}

function logMultiValueLine(terminal: TerminalLineLogger, columns: number, values: readonly string[]): void {
    const [ symbol = '', ...messageValues ] = values;
    const message = messageValues.join(' ');
    const continuationIndent = ' '.repeat(visibleTerminalWidth(symbol) + 1);
    const firstLineColumns = Math.max(minimumColumnWidth, columns - visibleTerminalWidth(continuationIndent));
    const [ firstLine = '', ...continuationLines ] = wrapText(message, firstLineColumns);

    terminal.line(symbol, firstLine);
    for (const continuationLine of continuationLines) {
        terminal.line(`${continuationIndent}${continuationLine}`);
    }
}

function logWrappedLine(
    terminal: TerminalLineLogger,
    columns: number,
    formatOptions: HumanReporterFormatOptions,
    ...values: readonly string[]
): void {
    if (!formatOptions.wrap || values.length === 0) {
        terminal.line(...values);
    } else if (values.length === 1) {
        logSingleValueLine(terminal, columns, values[0] ?? '');
    } else {
        logMultiValueLine(terminal, columns, values);
    }
}

function formatTestResult(
    event: TestEndEvent,
    prefix: string
): readonly [string, string] {
    const { outcome } = event;
    const name = prefix.length === 0 ? event.case.title : `${prefix} ${event.case.title}`;
    if (outcome === null || outcome.kind === 'fail') {
        return [ errorSymbol, name ];
    }
    const reason = outcomeReason(outcome);
    const message = reason === null ? name : `${name}: ${reason}`;
    return [ outcome.kind === 'pass' ? successSymbol : infoSymbol, message ];
}

function terminalVerdict(verdict: TestVerdict): string {
    return verdict === 'process-exhausted' ? 'process exhausted' : 'crashed';
}

function resultSuffix(event: TestEndEvent): string {
    const terminal = event.outcome === null ? `: ${terminalVerdict(event.verdict)}` : '';
    const retried = event.attempt === 0 ? '' : ` [${event.attempt + 1} attempts]`;
    return terminal + retried + formatDebugSummary(event.artifacts);
}

function formatResultTiming(message: string, duration: string, suffix: string, width: number | null): string {
    const inline = `${message} ${duration}${suffix}`;
    if (width === null || /[\n\r\t]/u.test(message + suffix)) {
        return inline;
    }

    const gap = width - visibleTerminalWidth(message + suffix) - visibleTerminalWidth(duration);
    return gap < minimumDurationGap ? inline : `${message}${suffix}${' '.repeat(gap)}${duration}`;
}

function formatOrphanLines(orphan: OrphanedNode, context: ReportingContext): readonly string[] {
    const sourceLocations = formatDefinitionLocations(orphan.definitionLocations, context);
    const location = sourceLocations.primary === null ? '' : ` (${sourceLocations.primary})`;

    return [
        `${orphan.kind}: ${orphan.title} (${orphan.file ?? '<unknown>'})${location}`,
        ...sourceLocations.details.map(function formatDetail(detail) {
            return `${indent(1)}${detail}`;
        })
    ];
}

function logProblems(terminal: TerminalLineLogger, lines: readonly string[]): void {
    if (lines.length === 0) {
        return;
    }
    for (const line of lines) {
        terminal.line(line);
    }
    terminal.line('');
}

function logSummary(terminal: TerminalLineLogger, result: RunResult): void {
    const failed = result.status === 'failed';
    const symbol = failed ? errorSymbol : successSymbol;
    const { summary } = result.timings;
    const headline = [
        failed ? 'Run failed' : 'Run passed',
        ...formatLineVerdicts(result),
        formatDuration(summary.totalWallTimeMicroseconds)
    ]
        .join(' · ');
    const timing = [
        `${formatDuration(summary.testExecutionWallTimeMicroseconds)} execution`,
        `${formatDuration(summary.runnerOverheadWallTimeMicroseconds)} overhead`
    ]
        .join(' · ');

    terminal.line(symbol, headline);
    terminal.line(`  ${formatLineExecutionCounts(result)} · ${timing}`);
}

function logOrphans(
    terminal: TerminalLineLogger,
    orphans: readonly OrphanedNode[],
    context: ReportingContext
): void {
    if (orphans.length === 0) {
        return;
    }

    for (const orphan of orphans) {
        const [ firstLine, ...detailLines ] = formatOrphanLines(orphan, context);
        terminal.line(infoSymbol, firstLine ?? '');
        for (const detailLine of detailLines) {
            terminal.line(detailLine);
        }
    }
}

function logFailurePreview(
    terminal: TerminalLineLogger,
    event: TestEndEvent,
    failure: TestFailure | undefined,
    context: ReportingContext
): void {
    const location = formatFailureLocation(failure, event.definitionLocations, context) ?? event.case.file;
    if (location !== null) {
        terminal.line(`  ${location}`);
    }
    if (failure !== undefined) {
        terminal.line(`  ${formatFailureSummary(failure)}`);
    }
}

function runStartLine(event: Extract<ReporterEvent, { readonly kind: 'run-start'; }>): string {
    const summary = formatRunFactSummary(event.facts);
    const details = summary === null ? '' : ` (${summary})`;

    return `Test run started: ${event.root.title}${details}`;
}

export function createLineReporter(dependencies: LineReporterDependencies): DefinedReporter<RealTimeReporter> {
    const { formatOptions, interactive, showPassing, stdoutConsole, verbose } = dependencies;
    return defineReporter(function createLineRuntimeReporter(context) {
        const terminal = createTerminalLineLogger({ stdoutConsole });
        let completed = 0;
        let planned: number | null = null;
        const wrappedTerminal: TerminalLineLogger = {
            line(...values) {
                logWrappedLine(terminal, dependencies.columns, formatOptions, ...values);
            }
        };

        function logProgress(): void {
            completed += 1;
            if (completed % progressInterval === 0 && completed !== planned) {
                const count = completed.toLocaleString('en-US');
                const progress = planned === null ? count : `${count}/${planned.toLocaleString('en-US')}`;
                wrappedTerminal.line(infoSymbol, `${progress} tests completed`);
            }
        }

        function logResult(event: TestEndEvent): void {
            const work = event.workId;
            const prefix = contextPrefix(work.runtimes, work.workload, event.case.suite, formatOptions);
            const [ symbol, message ] = formatTestResult(event, prefix);
            const width = interactive ? dependencies.columns - visibleTerminalWidth(symbol) - 1 : null;
            const duration = `(${formatDuration(event.durationMicroseconds)})`;
            wrappedTerminal.line(symbol, formatResultTiming(message, duration, resultSuffix(event), width));
            const { outcome } = event;
            if (outcome === null || outcome.kind === 'fail') {
                logFailurePreview(wrappedTerminal, event, outcome?.failures[0], context);
            }
        }

        function logTestEnd(event: TestEndEvent): void {
            if (event.completion === 'retry') {
                wrappedTerminal.line(infoSymbol, `Retry after attempt ${event.attempt + 1}: ${event.case.title}`);
                return;
            }
            if (!showPassing) {
                logProgress();
            }
            if (showPassing || event.verdict !== 'pass') {
                logResult(event);
            }
        }

        return {
            dispose: null,
            kind: 'real-time',
            name: 'line',
            sinks: [ { kind: 'stdout-raw' } ],

            async onEvent(event) {
                if (event.kind === 'run-start') {
                    planned = Array.isArray(event.facts.cases) ? event.facts.cases.length : null;
                    wrappedTerminal.line(infoSymbol, runStartLine(event));
                } else if (event.kind === 'test-end') {
                    logTestEnd(event);
                } else if (event.kind === 'runner-error') {
                    wrappedTerminal.line(errorSymbol, `Runner error: ${event.error.message}`);
                }
            },

            async onFinish({ result: finalResult }) {
                logProblems(terminal, problemLines(finalResult, context, { verbose }));
                logSummary(wrappedTerminal, finalResult);
                for (const line of formatCoverageSummaryLines(finalResult)) {
                    wrappedTerminal.line(infoSymbol, line);
                }
                for (const line of formatTimingOffenderLines(finalResult)) {
                    wrappedTerminal.line(line);
                }
                logOrphans(wrappedTerminal, finalResult.orphans, context);
            }
        };
    });
}
