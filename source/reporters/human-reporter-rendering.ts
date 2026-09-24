import colors from 'yoctocolors';
import { formatCaseId, type CaseId, type RuntimeId } from '../engine/identity.ts';
import { formatDefinitionLocations, type ReportingContext } from '../engine/reporting-context.ts';
import type { RunArtifact, RunResult, RunnerError } from '../engine/run-result.ts';
import { formatFailure } from './line-failure-rendering.ts';
import { formatTimingSummary as formatRunTimingSummary } from './run-timing-summary.ts';

const colorPalette = [
    colors.cyan,
    colors.green,
    colors.magenta,
    colors.yellow,
    colors.blue
] as const;
type ColorFormatter = (value: string) => string;
type TimingSummaryFormatter = (result: RunResult) => string;

export type HumanReporterFormatOptions = {
    readonly color: boolean;
    readonly wrap: boolean;
};

export type ProblemDetailOptions = {
    readonly verbose: boolean;
};

function executedCount(result: RunResult): number {
    const { summary } = result;

    return summary.passed + summary.failed + summary.skipped + summary.inconclusive +
        summary.resourceExhausted + summary.crashed + summary.runtimePolicy;
}

export const formatTimingSummary: TimingSummaryFormatter = formatRunTimingSummary;

export function formatCountSummary(result: RunResult): string {
    const { summary } = result;
    const outcomes = [
        `${summary.passed} pass`,
        `${summary.failed} fail`,
        `${summary.skipped} skip`,
        ...summary.inconclusive === 0 ? [] : [ `${summary.inconclusive} inconclusive` ],
        ...summary.resourceExhausted === 0 ? [] : [ `${summary.resourceExhausted} resource-exhausted` ],
        ...summary.runtimePolicy === 0 ? [] : [ `${summary.runtimePolicy} runtime-policy` ],
        ...summary.crashed === 0 ? [] : [ `${summary.crashed} crash` ]
    ]
        .join(', ');
    const orphanSummary = result.orphans.length === 0 ? '' : `, ${result.orphans.length} orphaned`;

    return `${summary.discovered} discovered, ${summary.planned} planned, ${executedCount(result)} executed ` +
        `(${outcomes})${orphanSummary}`;
}

function hashText(value: string): number {
    let hash = 0;

    for (const character of value) {
        hash += character.codePointAt(0) ?? 0;
    }

    return hash;
}

function paletteColor(value: string): ColorFormatter {
    return colorPalette[hashText(value) % colorPalette.length] ?? colors.cyan;
}

function formatColoredLabel(value: string, options: HumanReporterFormatOptions): string {
    if (!options.color) {
        return value;
    }

    return paletteColor(value)(value);
}

function runtimeLabel(runtime: RuntimeId): string {
    if (runtime.variantId !== null) {
        return `${runtime.name}:${runtime.variantId}`;
    }

    const dimensions = Object
        .entries(runtime.dimensions)
        .toSorted(function compareDimension([ left ], [ right ]) {
            return left.localeCompare(right);
        })
        .map(function formatDimension([ key, value ]) {
            return `${key}=${value}`;
        });

    return dimensions.length === 0 ? runtime.name : `${runtime.name}:${dimensions.join(',')}`;
}

function runtimePrefixes(runtimes: readonly RuntimeId[], options: HumanReporterFormatOptions): string {
    return runtimes
        .map(function formatRuntime(runtime) {
            const label = runtimeLabel(runtime);

            return `[${formatColoredLabel(label, options)}]`;
        })
        .join(' ');
}

function suiteLabel(path: string, topLevel: string, options: HumanReporterFormatOptions): string {
    if (!options.color) {
        return path;
    }

    return `${paletteColor(topLevel)(topLevel)}${path.slice(topLevel.length)}`;
}

function suitePrefix(suite: readonly string[], options: HumanReporterFormatOptions): string {
    if (suite.length === 0) {
        return '';
    }

    const path = suite.join(' > ');
    const topLevel = suite[0] ?? path;
    const label = suiteLabel(path, topLevel, options);

    return `[${label}]`;
}

export function contextPrefix(
    runtimes: readonly RuntimeId[],
    suite: readonly string[],
    options: HumanReporterFormatOptions
): string {
    return [ runtimePrefixes(runtimes, options), suitePrefix(suite, options) ]
        .filter(function present(value) {
            return value.length > 0;
        })
        .join(' ');
}

function formatRunnerError(error: RunnerError): readonly string[] {
    const attribution = error.attributedTo === null ? [] : [ `test: ${formatCaseId(error.attributedTo)}` ];
    const diagnostics = error.diagnostics.map(function formatDiagnostic(diagnostic) {
        return `${diagnostic.label}: ${diagnostic.value}`;
    });

    return [
        `Runner error: ${error.message}`,
        `type: ${error.subtype}`,
        ...attribution,
        ...diagnostics
    ];
}

function artifactCaseKey(id: CaseId): string {
    return JSON.stringify([ id.file, id.suite, id.title, id.params ]);
}

function caseArtifacts(result: RunResult, testResult: RunResult['perTest'][number]): readonly RunArtifact[] {
    const testKey = artifactCaseKey(testResult.id);

    return result.artifacts.filter(function artifactForCase(artifact) {
        return artifact.id.scope.kind === 'case' && artifactCaseKey(artifact.id.scope.case) === testKey;
    });
}

function runArtifacts(result: RunResult): readonly RunArtifact[] {
    return result.artifacts.filter(function isRunArtifact(artifact) {
        return artifact.id.scope.kind === 'run';
    });
}

function artifactLines(artifact: RunArtifact): readonly string[] {
    if (artifact.payload.kind !== 'captured-output') {
        return [];
    }

    const suffix = artifact.payload.truncated ? ' truncated' : '';
    const header = `${artifact.payload.stream}${suffix}:`;
    const textLines = artifact.payload.text.length === 0
        ? []
        : artifact.payload.text.replace(/\n$/u, '').split('\n');

    return [ header, ...textLines ];
}

function indentDetail(line: string): string {
    return `  ${line}`;
}

function failedTestLines(
    result: RunResult,
    testResult: RunResult['perTest'][number],
    context: ReportingContext,
    heading: string
): readonly string[] {
    if (testResult.outcome?.kind !== 'fail') {
        return [];
    }

    return [
        heading,
        ...testResult.outcome.failures.flatMap(function formatTestFailure(failure) {
            return formatFailure(failure, context).map(indentDetail);
        }),
        ...caseArtifacts(result, testResult).flatMap(function formatArtifact(artifact) {
            return artifactLines(artifact).map(indentDetail);
        })
    ];
}

function passedArtifactLines(
    result: RunResult,
    testResult: RunResult['perTest'][number],
    heading: string
): readonly string[] {
    return caseArtifacts(result, testResult).flatMap(function formatArtifact(artifact) {
        return [
            heading,
            ...artifactLines(artifact).map(indentDetail)
        ];
    });
}

function testProblemHeading(testResult: RunResult['perTest'][number], context: ReportingContext): string {
    const location = formatDefinitionLocations(testResult.definitionLocations, context).primary;
    const locationText = location === null ? '' : ` (${location})`;

    return `${formatCaseId(testResult.id)}${locationText}`;
}

type KnownOutcomeProblemInput = {
    readonly context: ReportingContext;
    readonly heading: string;
    readonly options: ProblemDetailOptions;
    readonly outcome: NonNullable<RunResult['perTest'][number]['outcome']>;
    readonly result: RunResult;
    readonly testResult: RunResult['perTest'][number];
};

function knownOutcomeProblemLines(input: KnownOutcomeProblemInput): readonly string[] {
    const { context, heading, options, outcome, result, testResult } = input;

    if (outcome.kind === 'fail') {
        return failedTestLines(result, testResult, context, heading);
    }

    if (outcome.kind === 'inconclusive') {
        return [ heading, `  ${outcome.reason}` ];
    }

    if (options.verbose && outcome.kind === 'pass') {
        return passedArtifactLines(result, testResult, heading);
    }

    return [];
}

function testProblemLines(
    result: RunResult,
    testResult: RunResult['perTest'][number],
    context: ReportingContext,
    options: ProblemDetailOptions
): readonly string[] {
    const heading = testProblemHeading(testResult, context);
    const { outcome } = testResult;

    if (outcome === null) {
        return [ heading, `  ${testResult.verdict}` ];
    }

    return knownOutcomeProblemLines({ context, heading, options, outcome, result, testResult });
}

function problemTestResult(testResult: RunResult['perTest'][number], verbose: boolean): boolean {
    const { outcome } = testResult;

    if (outcome === null) {
        return true;
    }

    if (outcome.kind === 'fail' || outcome.kind === 'inconclusive') {
        return true;
    }

    return verbose && outcome.kind === 'pass';
}

export function problemLines(
    result: RunResult,
    context: ReportingContext,
    options: ProblemDetailOptions
): readonly string[] {
    const testLines = result
        .perTest
        .filter(function isProblem(testResult) {
            return problemTestResult(testResult, options.verbose);
        })
        .flatMap(function formatProblem(testResult) {
            return testProblemLines(result, testResult, context, options);
        });
    const runnerErrorLines = result.runnerErrors.flatMap(formatRunnerError);
    const runArtifactLines = result.status === 'failed'
        ? runArtifacts(result).flatMap(artifactLines)
        : [];
    const lines = [ ...testLines, ...runnerErrorLines, ...runArtifactLines ];

    return lines.length === 0 ? [] : [
        'Problems',
        ...lines.map(function indentProblem(line) {
            return `  ${line}`;
        })
    ];
}
