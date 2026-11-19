import type { Profiler } from 'node:inspector';
import path from 'node:path';
import type { CoveragePolicy } from '../config/types.ts';
import type {
    CoverageArtifact,
    CoverageMetric,
    CoverageRunnerErrorCause,
    CoverageThresholdFailure
} from '../engine/coverage-artifact.ts';
import type { RunnerError, RunResult } from '../engine/run-result.ts';
import {
    emptyTimingSpanMetadata,
    type RunTimingMeasurement
} from './run-timing-collection.ts';
import type { SupervisedChildCoverage } from './supervised-child-process.ts';
import type {
    CoverageReportResult,
    CoverageReportRequest
} from './coverage-reporting.ts';
import type { CoveragePaths } from './coverage-paths.ts';
import type { CoverageProfiler } from './coverage-profiler.ts';

export type CoverageSession = {
    readonly childProcess: SupervisedChildCoverage | null;
    readonly dispose: () => Promise<void>;
    readonly finalize: (result: RunResult, executionCompleted: boolean) => Promise<RunResult>;
    readonly start: () => Promise<void>;
};

export type CoverageSessionRequest = {
    readonly coverage: CoveragePolicy;
    readonly processModel: 'in-process' | 'supervised-process';
    readonly paths: CoveragePaths;
    readonly testFiles: readonly string[];
    readonly timing: RunTimingMeasurement | null;
};

type AsyncOutcome<Value> = {
    readonly kind: 'failure';
    readonly error: unknown;
} | {
    readonly kind: 'success';
    readonly value: Value;
};

type EnvironmentVariables = Readonly<Record<string, string | undefined>>;
type CoverageLifecycle = {
    readonly isDisposed: () => boolean;
    readonly isStarted: () => boolean;
    readonly markDisposed: () => void;
    readonly markStarted: () => void;
};
type CoverageSessionContext = {
    readonly environment: EnvironmentVariables;
    readonly inspector: CoverageProfiler | null;
    readonly runtime: CoverageCollectionRuntime;
    readonly lifecycle: CoverageLifecycle;
    readonly paths: CoveragePaths;
    readonly previousCoverageEnvironment: string | undefined;
    readonly request: CoverageSessionRequest;
};

const percentageFactor = 100;
const percentagePrecision = 2;

async function attempt<Value>(work: () => Promise<Value>): Promise<AsyncOutcome<Value>> {
    try {
        return { kind: 'success', value: await work() };
    } catch (error: unknown) {
        return { error, kind: 'failure' };
    }
}

function projectRelativePath(projectRoot: string, filePath: string): string {
    return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function nextRunArtifactSequence(artifacts: RunResult['artifacts']): number {
    return artifacts.reduce(function nextSequence(sequence, artifact) {
        return artifact.id.scope.kind === 'run' ? Math.max(sequence, artifact.id.sequence + 1) : sequence;
    }, 0);
}

function coverageArtifact(
    paths: CoveragePaths,
    artifacts: RunResult['artifacts'],
    report: CoverageReportResult
): CoverageArtifact {
    return {
        id: {
            familyVariant: null,
            attempt: null,
            runtimes: [],
            scope: { kind: 'run' },
            sequence: nextRunArtifactSequence(artifacts),
            subtype: 'coverage',
            workload: null
        },
        payload: {
            completeness: 'complete',
            directory: projectRelativePath(paths.projectRoot, paths.coverageDirectory),
            kind: 'coverage',
            rawDataDirectory: projectRelativePath(paths.projectRoot, paths.rawDataDirectory),
            reports: report.reports.map(function relativeReportPath(file) {
                return {
                    format: file.format,
                    path: projectRelativePath(paths.projectRoot, file.path)
                };
            }),
            summary: report.summary
        },
        source: 'v8-native'
    };
}

function coverageRunnerError(
    error: unknown,
    paths: CoveragePaths,
    phase: Extract<CoverageRunnerErrorCause, { readonly kind: 'coverage-operation'; }>['phase']
): RunnerError {
    return {
        attributedToAttempt: null,
        attributedTo: null,
        cause: { error, kind: 'coverage-operation', phase },
        diagnostics: [
            { label: 'Coverage phase', value: phase },
            {
                label: 'Coverage directory',
                value: projectRelativePath(paths.projectRoot, paths.coverageDirectory)
            }
        ],
        message: error instanceof Error ? `Coverage failed: ${error.message}` : 'Coverage failed.',
        subtype: 'coverage'
    };
}

function resultWithCoverageError(result: RunResult, error: RunnerError): RunResult {
    return {
        ...result,
        runnerErrors: [ ...result.runnerErrors, error ],
        status: 'failed'
    };
}

function coverageSourceScope(
    policy: CoverageSessionRequest['coverage'],
    testFiles: readonly string[]
): CoverageReportRequest['sourceScope'] {
    const excludedFiles = new Set(testFiles.map(function resolveTestFile(filePath) {
        return path.resolve(filePath);
    }));

    return policy.sources.mode === 'loaded'
        ? {
            exclude: Array.from(policy.sources.exclude),
            excludedFiles,
            mode: 'loaded'
        }
        : {
            exclude: Array.from(policy.sources.exclude),
            excludedFiles,
            include: [ policy.sources.include[0], ...policy.sources.include.slice(1) ],
            mode: 'all'
        };
}

function coveragePercentage(metric: CoverageMetric): number {
    return metric.total === 0 ? percentageFactor : metric.covered / metric.total * percentageFactor;
}

function coveragePercentageText(percentage: number): string {
    return String(Number(percentage.toFixed(percentagePrecision)));
}

function thresholdFailures(
    summary: CoverageArtifact['payload']['summary'],
    policy: CoverageSessionRequest['coverage']
): readonly CoverageThresholdFailure[] {
    const metrics = [ 'lines', 'functions', 'branches' ] as const;

    return metrics.flatMap(function failedThreshold(metric) {
        const requiredPercentage = policy.thresholds[metric];

        if (requiredPercentage === null) {
            return [];
        }

        const actualPercentage = coveragePercentage(summary[metric]);

        return actualPercentage < requiredPercentage
            ? [ { actualPercentage, metric, requiredPercentage } ]
            : [];
    });
}

function coverageThresholdError(failures: readonly CoverageThresholdFailure[]): RunnerError | null {
    const [ firstFailure, ...remainingFailures ] = failures;

    if (firstFailure === undefined) {
        return null;
    }

    const allFailures = [ firstFailure, ...remainingFailures ] as const;

    return {
        attributedToAttempt: null,
        attributedTo: null,
        cause: { failures: allFailures, kind: 'coverage-threshold' },
        diagnostics: allFailures.map(function thresholdDiagnostic(failure) {
            return {
                label: `Coverage ${failure.metric}`,
                value: `${coveragePercentageText(failure.actualPercentage)}% is below ${failure.requiredPercentage}%`
            };
        }),
        message: 'Coverage thresholds were not met.',
        subtype: 'coverage'
    };
}

function resultWithCoverageArtifact(
    result: RunResult,
    artifact: CoverageArtifact,
    policy: CoverageSessionRequest['coverage']
): RunResult {
    const thresholdError = coverageThresholdError(thresholdFailures(artifact.payload.summary, policy));

    return thresholdError === null
        ? { ...result, artifacts: [ ...result.artifacts, artifact ] }
        : {
            ...result,
            artifacts: [ ...result.artifacts, artifact ],
            runnerErrors: [ ...result.runnerErrors, thresholdError ],
            status: 'failed'
        };
}

async function measureAsync<Value>(
    timing: RunTimingMeasurement | null,
    kind: 'coverage.collect' | 'coverage.report' | 'coverage.start',
    work: () => Promise<Value>
): Promise<Value> {
    return timing?.measureAsync(kind, emptyTimingSpanMetadata(), work) ?? work();
}

async function writeInspectorCoverage(
    context: CoverageSessionContext,
    inspector: CoverageProfiler
): Promise<void> {
    const coverage = await measureAsync(context.request.timing, 'coverage.collect', async function takeCoverage() {
        return await inspector.take();
    });

    await context.runtime.write(context.paths, coverage);
}

function createCoverageLifecycle(): CoverageLifecycle {
    let disposed = false;
    let started = false;

    return {
        isDisposed() {
            return disposed;
        },
        isStarted() {
            return started;
        },
        markDisposed() {
            disposed = true;
        },
        markStarted() {
            started = true;
        }
    };
}

function createCoverageSessionContext(
    request: CoverageSessionRequest,
    paths: CoveragePaths,
    runtime: CoverageCollectionRuntime
): CoverageSessionContext {
    const { environment } = runtime;

    return {
        environment,
        inspector: request.processModel === 'in-process' ? runtime.createProfiler() : null,
        runtime,
        lifecycle: createCoverageLifecycle(),
        paths,
        previousCoverageEnvironment: environment.NODE_V8_COVERAGE,
        request
    };
}

function supervisedChildCoverage(context: CoverageSessionContext): SupervisedChildCoverage | null {
    return context.request.processModel === 'supervised-process'
        ? {
            environment: {
                NODE_DISABLE_COMPILE_CACHE: '1',
                NODE_V8_COVERAGE: context.paths.rawDataDirectory
            },
            writablePath: `${context.paths.rawDataDirectory}${path.sep}*`
        }
        : null;
}

async function startCoverage(context: CoverageSessionContext): Promise<void> {
    if (context.lifecycle.isStarted()) {
        return;
    }

    context.lifecycle.markStarted();
    await measureAsync(context.request.timing, 'coverage.start', async function startInspectorCoverage() {
        if (context.inspector !== null) {
            Reflect.set(context.environment, 'NODE_V8_COVERAGE', context.paths.rawDataDirectory);
            context.inspector.connect();
            await context.inspector.enable();
            await context.inspector.start();
        }
    });
}

async function stopInspectorCoverage(context: CoverageSessionContext): Promise<void> {
    if (context.inspector === null || !context.lifecycle.isStarted() || context.lifecycle.isDisposed()) {
        return;
    }

    await writeInspectorCoverage(context, context.inspector);
    await context.inspector.stop();
    await context.inspector.disable();
    context.inspector.disconnect();
}

function restoreCoverageEnvironment(context: CoverageSessionContext): void {
    if (context.previousCoverageEnvironment === undefined) {
        Reflect.deleteProperty(context.environment, 'NODE_V8_COVERAGE');
    } else {
        Reflect.set(context.environment, 'NODE_V8_COVERAGE', context.previousCoverageEnvironment);
    }
}

async function closeInspector(context: CoverageSessionContext): Promise<void> {
    if (context.inspector === null || !context.lifecycle.isStarted()) {
        return;
    }

    const { inspector } = context;
    const outcome = await attempt(async function stopProfiler() {
        await inspector.stop();
        await inspector.disable();
    });

    inspector.disconnect();

    if (outcome.kind === 'failure') {
        throw outcome.error;
    }
}

async function disposeCoverage(context: CoverageSessionContext): Promise<void> {
    if (context.lifecycle.isDisposed()) {
        return;
    }

    context.lifecycle.markDisposed();
    const outcome = await attempt(async function closeCoverageInspector() {
        await closeInspector(context);
    });

    restoreCoverageEnvironment(context);

    if (outcome.kind === 'failure') {
        throw outcome.error;
    }
}

async function completeCoverageCollection(context: CoverageSessionContext): Promise<void> {
    await stopInspectorCoverage(context);
    context.lifecycle.markDisposed();
    restoreCoverageEnvironment(context);
}

async function completedCoverageResult(
    context: CoverageSessionContext,
    result: RunResult
): Promise<RunResult> {
    const report = await measureAsync(context.request.timing, 'coverage.report', async function reportCoverage() {
        return await context.runtime.report({
            coverageDirectory: context.paths.coverageDirectory,
            outputs: context.request.coverage.outputs,
            projectRoot: context.paths.projectRoot,
            rawDataDirectory: context.paths.rawDataDirectory,
            sourceScope: coverageSourceScope(context.request.coverage, context.request.testFiles)
        });
    });
    const artifact = coverageArtifact(context.paths, result.artifacts, report);

    return resultWithCoverageArtifact(result, artifact, context.request.coverage);
}

async function finalizeCoverage(
    context: CoverageSessionContext,
    result: RunResult,
    executionCompleted: boolean
): Promise<RunResult> {
    const collection = await attempt(async function collectCoverage() {
        await completeCoverageCollection(context);
    });

    if (collection.kind === 'failure') {
        const disposal = await attempt(async function disposeFailedCoverage() {
            await disposeCoverage(context);
        });
        const error = disposal.kind === 'failure'
            ? coverageRunnerError(disposal.error, context.paths, 'dispose')
            : coverageRunnerError(collection.error, context.paths, 'collect');

        return resultWithCoverageError(result, error);
    }

    if (!executionCompleted) {
        return result;
    }

    const report = await attempt(async function reportCoverage() {
        return await completedCoverageResult(context, result);
    });

    return report.kind === 'success'
        ? report.value
        : resultWithCoverageError(result, coverageRunnerError(report.error, context.paths, 'report'));
}

export type CoverageCollectionRuntime = {
    readonly environment: EnvironmentVariables;
    readonly createPaths: (paths: CoveragePaths) => Promise<CoveragePaths>;
    readonly createProfiler: () => CoverageProfiler;
    readonly report: (request: CoverageReportRequest) => Promise<CoverageReportResult>;
    readonly write: (paths: CoveragePaths, coverage: Profiler.TakePreciseCoverageReturnType) => Promise<void>;
};

export async function createCoverageCollection(
    request: CoverageSessionRequest,
    runtime: CoverageCollectionRuntime
): Promise<CoverageSession> {
    const paths = await runtime.createPaths(request.paths);
    const context = createCoverageSessionContext(request, paths, runtime);

    return {
        childProcess: supervisedChildCoverage(context),
        async dispose() {
            await disposeCoverage(context);
        },
        async finalize(result, executionCompleted) {
            return await finalizeCoverage(context, result, executionCompleted);
        },
        async start() {
            await startCoverage(context);
        }
    };
}
