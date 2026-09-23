import figures from 'figures';
import colors from 'yoctocolors';
import type { CaseId } from '../engine/identity.ts';
import { defineReporter, type DefinedReporter, type RealTimeReporter, type ReporterEvent } from '../engine/reporter.ts';
import {
    formatDefinitionLocations,
    type ReportingContext
} from '../engine/reporting-context.ts';
import type {
    OrphanedNode,
    RunResult,
    TestOutcome,
    TestVerdict
} from '../engine/run-result.ts';
import { formatFailureSummary } from './failure-summary.ts';
import { formatRunFactSummary } from './run-fact-summary.ts';
import { createTerminalLineLogger, type TerminalLineLogger, visibleTerminalWidth } from './terminal.ts';
import {
    contextPrefix,
    formatCountSummary,
    formatTimingSummary,
    problemLines,
    type HumanReporterFormatOptions
} from './human-reporter-rendering.ts';

const successSymbol = colors.green(figures.tick);
const errorSymbol = colors.red(figures.cross);
const infoSymbol = colors.cyan(figures.info);
const microsecondsPerMillisecond = 1000;
const minimumColumnWidth = 1;

type DefinitionLocationSummary = {
    readonly primary: string | null;
};

type WrapTextState = {
    readonly lines: readonly string[];
    readonly line: string;
};

export type LineReporterDependencies = {
    readonly columns: number;
    readonly formatOptions: HumanReporterFormatOptions;
    readonly stdoutConsole: Pick<typeof console, 'log'>;
    readonly verbose: boolean;
};

function indent(depth: number): string {
    return '  '.repeat(depth);
}

function formatCaseTitle(id: CaseId): string {
    if (id.params === null) {
        return id.title;
    }

    return `${id.title} [${id.params}]`;
}

function outcomeReason(outcome: TestOutcome): string | null {
    if (outcome.kind === 'skip' || outcome.kind === 'inconclusive') {
        return outcome.reason;
    }

    return null;
}

function formatDuration(durationMicroseconds: number): string {
    return `${durationMicroseconds / microsecondsPerMillisecond} ms`;
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

function outcomeDetail(outcome: TestOutcome): string {
    const reason = outcomeReason(outcome);

    if (reason !== null) {
        return `: ${reason}`;
    }

    if (outcome.kind !== 'fail') {
        return '';
    }

    return `: ${formatFailureSummary(outcome.failures[0])}`;
}

function formatTestResult(
    id: CaseId,
    outcome: TestOutcome,
    durationMicroseconds: number,
    prefix: string
): readonly [string, string] {
    const context = prefix.length === 0 ? '' : `${prefix} `;
    const message = `${context}${formatCaseTitle(id)}${outcomeDetail(outcome)} ` +
        `(${formatDuration(durationMicroseconds)})`;

    if (outcome.kind === 'fail') {
        return [ errorSymbol, message ];
    }

    if (outcome.kind === 'pass') {
        return [ successSymbol, message ];
    }

    return [ infoSymbol, message ];
}

function formatTerminalTestResult(
    id: CaseId,
    verdict: TestVerdict,
    durationMicroseconds: number,
    prefix: string
): readonly [string, string] {
    const context = prefix.length === 0 ? '' : `${prefix} `;
    const message = `${context}${formatCaseTitle(id)} (${formatDuration(durationMicroseconds)})`;

    if (verdict === 'resource-exhausted') {
        return [ errorSymbol, `${message}: resource exhausted` ];
    }

    return [ errorSymbol, `${message}: crashed` ];
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

function logSummary(terminal: TerminalLineLogger, result: RunResult): void {
    const symbol = result.status === 'failed' ? errorSymbol : successSymbol;

    terminal.line(
        symbol,
        `${formatCountSummary(result)} in ${formatDuration(result.timings.summary.totalWallTimeMicroseconds)} (${
            formatTimingSummary(result)
        })`
    );
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

function failureLocation(
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    definitionLocations: DefinitionLocationSummary
): string {
    if (event.outcome?.kind !== 'fail' || definitionLocations.primary === null) {
        return '';
    }

    return ` (${definitionLocations.primary})`;
}

function runStartLine(event: Extract<ReporterEvent, { readonly kind: 'run-start'; }>): string {
    const summary = formatRunFactSummary(event.facts);
    const details = summary === null ? '' : ` (${summary})`;

    return `Test run started: ${event.root.title}${details}`;
}

export function createLineReporter(dependencies: LineReporterDependencies): DefinedReporter<RealTimeReporter> {
    const { columns, formatOptions, stdoutConsole, verbose } = dependencies;
    return defineReporter(function createLineRuntimeReporter(context) {
        const terminal = createTerminalLineLogger({ stdoutConsole });
        const wrappedTerminal: TerminalLineLogger = {
            line(...values) {
                logWrappedLine(terminal, columns, formatOptions, ...values);
            }
        };

        function logTestEnd(event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>): void {
            const prefix = contextPrefix(event.workId?.runtimes ?? [], event.case.suite, formatOptions);
            const [ symbol, message ] = event.outcome === null
                ? formatTerminalTestResult(event.case, event.verdict, event.durationMicroseconds, prefix)
                : formatTestResult(event.case, event.outcome, event.durationMicroseconds, prefix);
            const definitionLocations = formatDefinitionLocations(event.definitionLocations, context);

            wrappedTerminal.line(symbol, `${message}${failureLocation(event, definitionLocations)}`);
        }

        return {
            dispose: null,
            kind: 'real-time',
            name: 'line',
            sinks: [ { kind: 'stdout-raw' } ],

            async onEvent(event) {
                if (event.kind === 'run-start') {
                    wrappedTerminal.line(infoSymbol, runStartLine(event));
                } else if (event.kind === 'test-end') {
                    logTestEnd(event);
                } else if (event.kind === 'runner-error') {
                    wrappedTerminal.line(errorSymbol, `Runner error: ${event.error.message}`);
                }
            },

            async onFinish(finalResult) {
                const lines = problemLines(finalResult, context, { verbose });

                for (const line of lines) {
                    wrappedTerminal.line(line);
                }
                logSummary(wrappedTerminal, finalResult);
                logOrphans(wrappedTerminal, finalResult.orphans, context);
            }
        };
    });
}
