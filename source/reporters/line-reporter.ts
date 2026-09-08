import figures from 'figures';
import colors from 'yoctocolors';
import type { CaseId } from '../engine/identity.ts';
import { defineReporter, type DefinedReporter, type RealTimeReporter, type ReporterEvent } from '../engine/reporter.ts';
import {
    formatDefinitionLocations,
    type RenderedSourceLocations,
    type ReportingContext
} from '../engine/reporting-context.ts';
import type {
    FailOutcome,
    OrphanedNode,
    RunArtifact,
    RunResult,
    TestOutcome,
    TestVerdict
} from '../engine/run-result.ts';
import { formatFailure } from './line-failure-rendering.ts';
import { createTerminalLineLogger, type TerminalLineLogger } from './terminal.ts';

const successSymbol = colors.green(figures.tick);
const errorSymbol = colors.red(figures.cross);
const infoSymbol = colors.cyan(figures.info);

export type LineReporterDependencies = {
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

function formatDuration(wallTimeMs: number): string {
    return `${wallTimeMs} ms`;
}

function formatTestResult(id: CaseId, outcome: TestOutcome, wallTimeMs: number): readonly [string, string] {
    const reason = outcomeReason(outcome);
    const detail = reason === null ? '' : `: ${reason}`;
    const message = `${formatCaseTitle(id)}${detail} (${formatDuration(wallTimeMs)})`;

    if (outcome.kind === 'fail') {
        return [ errorSymbol, message ];
    }

    if (outcome.kind === 'pass') {
        return [ successSymbol, message ];
    }

    return [ infoSymbol, message ];
}

function formatTerminalTestResult(id: CaseId, verdict: TestVerdict, wallTimeMs: number): readonly [string, string] {
    const message = `${formatCaseTitle(id)} (${formatDuration(wallTimeMs)})`;

    if (verdict === 'resource-exhausted') {
        return [ errorSymbol, `${message}: resource exhausted` ];
    }

    return [ errorSymbol, `${message}: crashed` ];
}

function formatSuiteName(event: Extract<ReporterEvent, { readonly kind: 'suite-start'; }>): string {
    return event.suitePath.at(-1)?.title ?? '';
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

function logFailures(
    terminal: TerminalLineLogger,
    suiteDepth: number,
    outcome: FailOutcome,
    context: ReportingContext
): void {
    for (const failure of outcome.failures) {
        for (const line of formatFailure(failure, context)) {
            terminal.line(`${indent(suiteDepth + 1)}${line}`);
        }
    }
}

function logSummary(terminal: TerminalLineLogger, result: RunResult): void {
    const { summary } = result;
    const executed = summary.passed + summary.failed + summary.skipped + summary.inconclusive +
        summary.crashed + summary.resourceExhausted;
    const outcomes = [
        `${summary.passed} pass`,
        `${summary.failed} fail`,
        `${summary.skipped} skip`,
        ...summary.inconclusive === 0 ? [] : [ `${summary.inconclusive} inconclusive` ],
        ...summary.resourceExhausted === 0 ? [] : [ `${summary.resourceExhausted} resource-exhausted` ],
        ...summary.crashed === 0 ? [] : [ `${summary.crashed} crash` ]
    ]
        .join(', ');
    const orphanSummary = result.orphans.length === 0 ? '' : `, ${result.orphans.length} orphaned`;
    const countSummary = `${summary.discovered} discovered, ${summary.planned} planned, ${executed} executed`;

    terminal.line(
        infoSymbol,
        `${countSummary} (${outcomes})${orphanSummary} in ${formatDuration(result.wallTimeMs)}`
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

function outputArtifactLines(artifact: RunArtifact): readonly string[] {
    const suffix = artifact.payload.truncated ? ' truncated' : '';
    const header = `${artifact.payload.stream}${suffix}:`;
    const textLines = artifact.payload.text.length === 0 ? [] : artifact.payload.text.replace(/\n$/u, '').split('\n');

    return [ header, ...textLines ];
}

function logOutputArtifacts(
    terminal: TerminalLineLogger,
    suiteDepth: number,
    artifacts: readonly RunArtifact[]
): void {
    for (const artifact of artifacts) {
        for (const line of outputArtifactLines(artifact)) {
            terminal.line(`${indent(suiteDepth + 1)}${line}`);
        }
    }
}

function shouldLogTestArtifacts(
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    verbose: boolean
): boolean {
    return event.verdict !== 'pass' || verbose;
}

function failureLocation(
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    definitionLocations: RenderedSourceLocations
): string {
    if (event.outcome?.kind !== 'fail' || definitionLocations.primary === null) {
        return '';
    }

    return ` (${definitionLocations.primary})`;
}

function nonGreenRun(result: RunResult): boolean {
    return result.runnerErrors.length > 0 ||
        result.summary.crashed > 0 ||
        result.summary.failed > 0 ||
        result.summary.inconclusive > 0 ||
        result.summary.resourceExhausted > 0 ||
        result.summary.runtimePolicy > 0;
}

function runArtifacts(result: RunResult): readonly RunArtifact[] {
    return result.artifacts.filter(function isRunArtifact(artifact) {
        return artifact.id.scope.kind === 'run';
    });
}

export function createLineReporter(dependencies: LineReporterDependencies): DefinedReporter<RealTimeReporter> {
    const { stdoutConsole, verbose } = dependencies;
    return defineReporter(function createLineRuntimeReporter(context) {
        const terminal = createTerminalLineLogger({ stdoutConsole });
        let suiteDepth = 0;

        function logFailureDetails(
            event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
            definitionLocations: RenderedSourceLocations
        ): void {
            if (event.outcome?.kind !== 'fail') {
                return;
            }

            for (const detailLine of definitionLocations.details) {
                terminal.line(`${indent(suiteDepth + 1)}${detailLine}`);
            }
            logFailures(terminal, suiteDepth, event.outcome, context);
        }

        function logTestEnd(event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>): void {
            const [ symbol, message ] = event.outcome === null
                ? formatTerminalTestResult(event.case, event.verdict, event.wallTimeMs)
                : formatTestResult(event.case, event.outcome, event.wallTimeMs);
            const definitionLocations = formatDefinitionLocations(event.definitionLocations, context);

            terminal.line(symbol, `${indent(suiteDepth)}${message}${failureLocation(event, definitionLocations)}`);
            logFailureDetails(event, definitionLocations);
            if (shouldLogTestArtifacts(event, verbose)) {
                logOutputArtifacts(terminal, suiteDepth, event.artifacts);
            }
        }

        function logSuiteStart(event: Extract<ReporterEvent, { readonly kind: 'suite-start'; }>): void {
            terminal.line(infoSymbol, `${indent(suiteDepth)}${formatSuiteName(event)}`);
            suiteDepth += 1;
        }

        return {
            dispose: null,
            kind: 'real-time',
            name: 'line',
            sinks: [ { kind: 'stdout-raw' } ],

            async onEvent(event) {
                if (event.kind === 'run-start') {
                    terminal.line(infoSymbol, `Test run started: ${event.root.title}`);
                } else if (event.kind === 'suite-start') {
                    logSuiteStart(event);
                } else if (event.kind === 'suite-end') {
                    suiteDepth = Math.max(0, suiteDepth - 1);
                } else if (event.kind === 'test-end') {
                    logTestEnd(event);
                } else if (event.kind === 'runner-error') {
                    terminal.line(errorSymbol, `Runner error: ${event.error.message}`);
                }
            },

            async onFinish(finalResult) {
                logSummary(terminal, finalResult);
                if (nonGreenRun(finalResult) || verbose) {
                    logOutputArtifacts(terminal, 0, runArtifacts(finalResult));
                }
                logOrphans(terminal, finalResult.orphans, context);
            }
        };
    });
}
