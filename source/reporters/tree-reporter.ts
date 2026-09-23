import figures from 'figures';
import colors from 'yoctocolors';
import { defineReporter, type DefinedReporter, type FinalResultReporter } from '../engine/reporter.ts';
import type { ReportingContext } from '../engine/reporting-context.ts';
import type { RunResult } from '../engine/run-result.ts';
import {
    formatCountSummary,
    formatTimingSummary,
    problemLines
} from './human-reporter-rendering.ts';

export type TreeReporterDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

export type TreeReporterOptions = {
    readonly showPassing: boolean;
    readonly verbose: boolean;
};

const successSymbol = colors.green(figures.tick);
const errorSymbol = colors.red(figures.cross);
const skipSymbol = colors.cyan('°');
const inconclusiveSymbol = colors.cyan('?');
const crashSymbol = colors.red(figures.warning);
const microsecondsPerMillisecond = 1000;

function formatDuration(durationMicroseconds: number): string {
    return `${durationMicroseconds / microsecondsPerMillisecond} ms`;
}

function symbolFor(testResult: RunResult['perTest'][number]): string {
    if (testResult.verdict === 'pass') {
        return successSymbol;
    }

    if (testResult.verdict === 'skip') {
        return skipSymbol;
    }

    if (testResult.verdict === 'inconclusive') {
        return inconclusiveSymbol;
    }

    if (testResult.verdict === 'fail') {
        return errorSymbol;
    }

    return crashSymbol;
}

function resultVisible(testResult: RunResult['perTest'][number], options: TreeReporterOptions): boolean {
    return options.showPassing || testResult.verdict !== 'pass';
}

function caseLine(testResult: RunResult['perTest'][number]): string {
    const params = testResult.id.params === null ? '' : ` [${testResult.id.params}]`;

    return `${symbolFor(testResult)} ${testResult.id.title}${params} ` +
        `(${formatDuration(testResult.durationMicroseconds)})`;
}

function indent(depth: number): string {
    return '  '.repeat(depth);
}

type TreeLineState = {
    readonly currentFile: string | null;
    readonly currentSuite: readonly string[];
    readonly fileStarted: boolean;
    readonly lines: readonly string[];
};

function appendFileLine(state: TreeLineState, testResult: RunResult['perTest'][number]): TreeLineState {
    if (state.fileStarted && testResult.id.file === state.currentFile) {
        return state;
    }

    return {
        currentFile: testResult.id.file,
        currentSuite: [],
        fileStarted: true,
        lines: [ ...state.lines, testResult.id.file ?? '<unknown>' ]
    };
}

function appendSuiteLines(state: TreeLineState, suite: readonly string[]): TreeLineState {
    const { currentSuite: previousSuite } = state;
    const lines = Array.from(state.lines);
    let currentSuite = previousSuite;

    for (let index = 0; index < suite.length; index += 1) {
        const [ title ] = suite.slice(index, index + 1);
        const previous = currentSuite[index];

        if (title !== previous) {
            currentSuite = suite.slice(0, index + 1);
            lines.push(`${indent(index + 1)}${title}`);
        }
    }

    return { ...state, currentSuite, lines };
}

function appendTestLine(state: TreeLineState, testResult: RunResult['perTest'][number]): TreeLineState {
    const lines = [
        ...state.lines,
        `${indent(testResult.id.suite.length + 1)}${caseLine(testResult)}`
    ];

    return { ...state, lines };
}

function appendVisibleTestResult(state: TreeLineState, testResult: RunResult['perTest'][number]): TreeLineState {
    return appendTestLine(
        appendSuiteLines(
            appendFileLine(state, testResult),
            testResult.id.suite
        ),
        testResult
    );
}

function treeLines(result: RunResult, options: TreeReporterOptions): readonly string[] {
    const initialState: TreeLineState = { currentFile: null, currentSuite: [], fileStarted: false, lines: [] };
    const state = result
        .perTest
        .filter(function includeResult(testResult) {
            return resultVisible(testResult, options);
        })
        .reduce(appendVisibleTestResult, initialState);

    return state.lines;
}

function treeSummaryLine(result: RunResult): string {
    const symbol = result.status === 'failed' ? errorSymbol : successSymbol;

    return `${symbol} ${formatCountSummary(result)} in ${
        formatDuration(result.timings.summary.totalWallTimeMicroseconds)
    } (${formatTimingSummary(result)})`;
}

export function treeResultLines(
    result: RunResult,
    context: ReportingContext,
    options: TreeReporterOptions
): readonly string[] {
    return [
        ...treeLines(result, options),
        ...problemLines(result, context, { verbose: options.verbose }),
        treeSummaryLine(result)
    ];
}

export function createTreeReporter(
    dependencies: TreeReporterDependencies,
    options: TreeReporterOptions
): DefinedReporter<FinalResultReporter> {
    return defineReporter(function createTreeRuntimeReporter(context) {
        return {
            dispose: null,
            kind: 'final-result',
            name: 'tree',
            sinks: [ { kind: 'stdout-raw' } ],

            onResult(result) {
                for (const line of treeResultLines(result, context, options)) {
                    dependencies.stdoutConsole.log(line);
                }
            }
        };
    });
}
