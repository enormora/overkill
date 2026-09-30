import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { Session, type Profiler } from 'node:inspector';
import path from 'node:path';
import { ulid } from 'ulid';
import type { CoverageArtifact } from '../engine/coverage-artifact.ts';
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
import { generateCoverageReports, type CoverageSourceScope } from './coverage-reporting.ts';
import { isPathInside } from './path-containment.ts';

export type CoverageSession = {
    readonly childProcess: SupervisedChildCoverage | null;
    readonly dispose: () => Promise<void>;
    readonly finalize: (result: RunResult, executionCompleted: boolean) => Promise<RunResult>;
    readonly start: () => Promise<void>;
};

export type CoverageSessionRequest = {
    readonly processModel: 'in-process' | 'supervised-process';
    readonly projectRoot: string;
    readonly runtimeStateDir: string;
    readonly testFiles: readonly string[];
    readonly timing: RunTimingMeasurement | null;
};

type CoveragePaths = {
    readonly coverageDirectory: string;
    readonly projectRoot: string;
    readonly rawDataDirectory: string;
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

async function nearestExistingPath(candidate: string): Promise<string> {
    try {
        return await realpath(candidate);
    } catch (error: unknown) {
        const parentPath = path.dirname(candidate);

        if (parentPath === candidate) {
            throw error;
        }

        return await nearestExistingPath(parentPath);
    }
}

async function validateCreatedCoverageDirectory(projectRoot: string, coverageDirectory: string): Promise<void> {
    if (!isPathInside(projectRoot, await realpath(coverageDirectory))) {
        throw new Error('Coverage output directory resolves outside the project root.');
    }
}

async function createCoveragePaths(request: CoverageSessionRequest): Promise<CoveragePaths> {
    const projectRoot = await realpath(request.projectRoot);
    const runtimeStateRoot = path.isAbsolute(request.runtimeStateDir)
        ? path.resolve(request.runtimeStateDir)
        : path.resolve(projectRoot, request.runtimeStateDir);
    const coverageDirectory = path.join(runtimeStateRoot, 'runs', ulid(), 'coverage');
    const existingAncestor = await nearestExistingPath(coverageDirectory);

    if (
        [ coverageDirectory, existingAncestor ].some(function escapesProject(candidate) {
            return !isPathInside(projectRoot, candidate);
        })
    ) {
        throw new Error('Coverage output directory must remain inside the project root.');
    }

    const rawDataDirectory = path.join(coverageDirectory, 'raw');

    await mkdir(rawDataDirectory, { recursive: true });
    await validateCreatedCoverageDirectory(projectRoot, coverageDirectory);

    return { coverageDirectory, projectRoot, rawDataDirectory };
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
    summary: CoverageArtifact['payload']['summary']
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
            reports: [
                {
                    format: 'lcov',
                    path: projectRelativePath(paths.projectRoot, path.join(paths.coverageDirectory, 'lcov.info'))
                },
                {
                    format: 'v8',
                    path: projectRelativePath(paths.projectRoot, path.join(paths.coverageDirectory, 'v8', 'index.html'))
                }
            ],
            summary
        },
        source: 'v8-native'
    };
}

function coverageRunnerError(error: unknown, paths: CoveragePaths, phase: string): RunnerError {
    return {
        attributedTo: null,
        cause: error,
        diagnostics: [
            { label: 'Coverage phase', value: phase },
            {
                label: 'Coverage directory',
                value: projectRelativePath(paths.projectRoot, paths.coverageDirectory)
            }
        ],
        message: error instanceof Error ? `Coverage failed: ${error.message}` : 'Coverage failed.',
        subtype: 'runtime-state'
    };
}

function resultWithCoverageError(result: RunResult, error: RunnerError): RunResult {
    return {
        ...result,
        runnerErrors: [ ...result.runnerErrors, error ],
        status: 'failed'
    };
}

function loadedSourceScope(testFiles: readonly string[]): CoverageSourceScope {
    return {
        excludedFiles: new Set(testFiles.map(function resolveTestFile(filePath) {
            return path.resolve(filePath);
        })),
        kind: 'loaded'
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

async function completedCoverageResult(
    context: CoverageSessionContext,
    result: RunResult,
    executionCompleted: boolean
): Promise<RunResult> {
    await stopInspectorCoverage(context);
    context.lifecycle.markDisposed();
    restoreCoverageEnvironment(context);

    if (!executionCompleted) {
        return result;
    }

    const summary = await measureAsync(context.request.timing, 'coverage.report', async function reportCoverage() {
        return await generateCoverageReports({
            coverageDirectory: context.paths.coverageDirectory,
            projectRoot: context.paths.projectRoot,
            rawDataDirectory: context.paths.rawDataDirectory,
            sourceScope: loadedSourceScope(context.request.testFiles)
        });
    });

    return {
        ...result,
        artifacts: [ ...result.artifacts, coverageArtifact(context.paths, result.artifacts, summary) ]
    };
}

async function finalizeCoverage(
    context: CoverageSessionContext,
    result: RunResult,
    executionCompleted: boolean
): Promise<RunResult> {
    const outcome = await attempt(async function completeCoverage() {
        return await completedCoverageResult(context, result, executionCompleted);
    });

    if (outcome.kind === 'success') {
        return outcome.value;
    }

    const disposal = await attempt(async function disposeFailedCoverage() {
        await disposeCoverage(context);
    });

    const error = disposal.kind === 'failure'
        ? coverageRunnerError(disposal.error, context.paths, 'dispose')
        : coverageRunnerError(outcome.error, context.paths, 'finalize');

    return resultWithCoverageError(result, error);
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
