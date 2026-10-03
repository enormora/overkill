import { writeFile } from 'node:fs/promises';
import { Session, type Profiler } from 'node:inspector';
import path from 'node:path';
import type {
    CoverageArtifact,
    CoverageMetric,
    CoverageRunnerErrorCause,
    CoverageThresholdFailure
} from '../engine/coverage-artifact.ts';
import type {
    RunArtifact,
    RunnerError,
    RunResult
} from '../engine/run-result.ts';
import {
    emptyTimingSpanMetadata,
    type RunTimingMeasurement
} from './run-timing-collection.ts';
import type { SupervisedChildCoverage } from './supervised-child-process.ts';
import {
    generateCoverageReports,
    type CoverageReportResult,
    type CoverageSourceScope
} from './coverage-reporting.ts';
import { createCoveragePaths, type CoveragePaths } from './coverage-paths.ts';
import type { RunCoveragePolicy } from './run-types.ts';

export type CoverageSession = {
    readonly childProcess: SupervisedChildCoverage | null;
    readonly dispose: () => Promise<void>;
    readonly finalize: (result: RunResult, executionCompleted: boolean) => Promise<RunResult>;
    readonly start: () => Promise<void>;
};

export type CoverageSessionRequest = {
    readonly coverage: RunCoveragePolicy;
    readonly processModel: 'in-process' | 'supervised-process';
    readonly projectRoot: string;
    readonly runtimeStateDir: string;
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
type ProfilerControlCommand = 'Profiler.disable' | 'Profiler.enable' | 'Profiler.stopPreciseCoverage';
type CoverageLifecycle = {
    readonly isDisposed: () => boolean;
    readonly isStarted: () => boolean;
    readonly markDisposed: () => void;
    readonly markStarted: () => void;
};
type CoverageSessionContext = {
    readonly environment: EnvironmentVariables;
    readonly inspector: Session | null;
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

async function postProfilerControl(inspector: Session, method: ProfilerControlCommand): Promise<void> {
    await new Promise<void>(function postCommand(resolve, reject) {
        inspector.post(method, function completeCommand(error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

async function startPreciseCoverage(inspector: Session): Promise<void> {
    await new Promise<void>(function postCommand(resolve, reject) {
        inspector.post('Profiler.startPreciseCoverage', {
            allowTriggeredUpdates: false,
            callCount: true,
            detailed: true
        }, function completeCommand(error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

async function takePreciseCoverage(inspector: Session): Promise<Profiler.TakePreciseCoverageReturnType> {
    return await new Promise<Profiler.TakePreciseCoverageReturnType>(function postCommand(resolve, reject) {
        inspector.post('Profiler.takePreciseCoverage', function completeCommand(error, result) {
            if (error === null) {
                resolve(result);
            } else {
                reject(error);
            }
        });
    });
}

function projectRelativePath(projectRoot: string, filePath: string): string {
    return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function nextRunArtifactSequence(artifacts: readonly RunArtifact[]): number {
    return artifacts.reduce(function nextSequence(sequence, artifact) {
        return artifact.id.scope.kind === 'run' ? Math.max(sequence, artifact.id.sequence + 1) : sequence;
    }, 0);
}

function coverageArtifact(
    paths: CoveragePaths,
    artifacts: readonly RunArtifact[],
    report: CoverageReportResult
): CoverageArtifact {
    return {
        id: {
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
    policy: RunCoveragePolicy,
    testFiles: readonly string[]
): CoverageSourceScope {
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
    policy: RunCoveragePolicy
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
    policy: RunCoveragePolicy
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
    inspector: Session,
    paths: CoveragePaths,
    timing: RunTimingMeasurement | null
): Promise<void> {
    const coverage = await measureAsync(timing, 'coverage.collect', async function takeCoverage() {
        return await takePreciseCoverage(inspector);
    });

    await writeFile(
        path.join(paths.rawDataDirectory, `coverage-${process.pid}-in-process.json`),
        JSON.stringify({ result: coverage.result, timestamp: Date.now() }),
        'utf8'
    );
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
    paths: CoveragePaths
): CoverageSessionContext {
    const environment: EnvironmentVariables = Reflect.get(process, 'env');

    return {
        environment,
        inspector: request.processModel === 'in-process' ? new Session() : null,
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
            await postProfilerControl(context.inspector, 'Profiler.enable');
            await startPreciseCoverage(context.inspector);
        }
    });
}

async function stopInspectorCoverage(context: CoverageSessionContext): Promise<void> {
    if (context.inspector === null || !context.lifecycle.isStarted() || context.lifecycle.isDisposed()) {
        return;
    }

    await writeInspectorCoverage(context.inspector, context.paths, context.request.timing);
    await postProfilerControl(context.inspector, 'Profiler.stopPreciseCoverage');
    await postProfilerControl(context.inspector, 'Profiler.disable');
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
        await postProfilerControl(inspector, 'Profiler.stopPreciseCoverage');
        await postProfilerControl(inspector, 'Profiler.disable');
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
        return await generateCoverageReports({
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

export async function createCoverageSession(request: CoverageSessionRequest): Promise<CoverageSession> {
    const paths = await createCoveragePaths(request);
    const context = createCoverageSessionContext(request, paths);

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
