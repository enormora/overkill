import { createClock } from '@enormora/clock';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { createRunCoordinator, type RunCoordinator } from '../run/run.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import type { CollectedRunPlan, WorkId } from '../run/run-types.ts';
import { supervisedAssignedWork } from '../run/supervised-protocol.ts';
import { benchmarkHostSnapshot } from './benchmark-host-snapshot.ts';
import {
    createFakeSupervisedChildProcess,
    type FakeSupervisedChildRunContext
} from './fake-supervised-child-process.ts';
import { createTestEngine } from './create-test-engine.ts';
import {
    createDeterministicRunResult,
    createDeterministicProcessUsageTracker,
    processUsageSample,
    deterministicProcessUsage,
    sampledActiveResourceCount,
    sampledResidentSetBytes,
    createDeterministicRunTestModuleLoader,
    deterministicCollectedRunPlan,
    deterministicRunCollection,
    deterministicRunEngine,
    deterministicRuntimeState
} from './deterministic-run-fixtures.ts';

type RunOrchestrator = RunCoordinator['orchestrator'];

const deterministicSeed = 99n;

type DeterministicDiscoveredFile = {
    readonly file: string;
    readonly fileSet: null;
    readonly href: string;
    readonly path: string;
};

function discoveredFile(cwd: string, file: string): DeterministicDiscoveredFile {
    const filePath = `${cwd}/${file}`;

    return {
        file,
        fileSet: null,
        href: `virtual:${file}`,
        path: filePath
    };
}

function installNoPolicyRestriction(): () => void {
    return function restoreNoPolicyRestriction(): void {
        return undefined;
    };
}

function createMissingWorkerPool(): never {
    throw new Error('Deterministic worker-pool execution is not configured.');
}

function createCollectionOnlyWorkerPool(
    options: Parameters<RunOrchestratorDependencies['createWorkerPool']>[0]
): ReturnType<RunOrchestratorDependencies['createWorkerPool']> {
    return {
        async destroy() {
            return undefined;
        },
        options: {
            isolateWorkers: options.workerLifecycle === 'fresh-worker-per-unit',
            maxThreads: options.workerCount
        },
        async run() {
            return {
                collectedPlan: deterministicCollectedRunPlan(
                    'source/integration-tests/run/fixtures/passing.test.ts'
                ),
                runnerErrors: []
            };
        }
    };
}

function emitTestStart(context: FakeSupervisedChildRunContext, work: WorkId): void {
    context.emitMessage({
        event: {
            attempt: 1,
            case: work.case,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-start',
            suitePath: [],
            workId: work
        },
        kind: 'event'
    });
}

function emitTestEnd(
    context: FakeSupervisedChildRunContext,
    work: WorkId,
    verdict: 'pass' | 'runtime-policy'
): void {
    context.emitMessage({
        event: {
            property: null,
            benchmark: null,
            completion: 'final',
            attempt: 1,
            artifacts: [],
            case: work.case,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-end',
            outcome: verdict === 'pass' ? { kind: 'pass' } : null,
            suitePath: [],
            verdict,
            durationMicroseconds: 0,
            workId: work
        },
        kind: 'event'
    });
}

function emitProcessEnvironmentPolicyError(context: FakeSupervisedChildRunContext): void {
    const [ work ] = supervisedAssignedWork(context.assignment);

    if (work === undefined) {
        return;
    }

    context.emitMessage({
        event: {
            error: {
                attributedToAttempt: null,
                attributedTo: work.case,
                attributedToWork: work,
                cause: { capability: 'process-env' },
                diagnostics: [],
                message: 'Runtime policy violation: process.env value was set: OVERKILL_CASE_POLICY_FIXTURE.',
                subtype: 'runtime-policy'
            },
            kind: 'runner-error'
        },
        kind: 'event'
    });
}

function emitProcessEnvironmentPolicyRun(context: FakeSupervisedChildRunContext, work: WorkId): boolean {
    if (!context.testFile.includes('env-policy')) {
        return false;
    }

    emitProcessEnvironmentPolicyError(context);
    emitTestEnd(context, work, 'runtime-policy');
    context.emitExit();

    return true;
}

function emitProcessUsageSamples(context: FakeSupervisedChildRunContext): void {
    context.emitSample(processUsageSample(1, 0, 1));
    context.emitSample(processUsageSample(sampledActiveResourceCount, 1, sampledResidentSetBytes));
}

function collectedCaseIdentity(file: string, testCase: CollectedRunPlan['files'][number]['cases'][number]): string {
    const suiteTitles = testCase.suitePath.map(function toSuiteTitle(suite) {
        return suite.title;
    });

    return JSON.stringify([ file, suiteTitles, testCase.title, testCase.params ]);
}

function collectedPlanForAssignedCases(
    collectedPlan: CollectedRunPlan,
    assignedWork: readonly WorkId[]
): CollectedRunPlan {
    const assignedCaseKeys = new Set(assignedWork.map(function toCaseKey(work) {
        return JSON.stringify([ work.case.file, work.case.suite, work.case.title, work.case.params ]);
    }));

    return {
        ...collectedPlan,
        files: collectedPlan.files.flatMap(function selectFileCases(file) {
            const cases = file.cases.filter(function isAssignedCase(testCase) {
                return assignedCaseKeys.has(collectedCaseIdentity(file.file, testCase));
            });

            return cases.length === 0 ? [] : [ { ...file, cases } ];
        })
    };
}

function completeDeterministicSupervisedChild(
    context: FakeSupervisedChildRunContext,
    alreadyReportedWorkCount: number
): void {
    const collectedPlan = deterministicCollectedRunPlan(context.testFile, context.command.root);
    const assignedWork = supervisedAssignedWork(context.assignment);

    for (const work of assignedWork.slice(alreadyReportedWorkCount)) {
        emitTestStart(context, work);
        emitTestEnd(context, work, 'pass');
    }
    context.emitMessage({
        kind: 'result',
        result: createDeterministicRunResult(
            collectedPlanForAssignedCases(collectedPlan, assignedWork),
            assignedWork,
            deterministicProcessUsage()
        )
    });
    context.emitExit();
}

function assignedFirstWork(context: FakeSupervisedChildRunContext): WorkId | null {
    const [ firstWork ] = supervisedAssignedWork(context.assignment);

    if (firstWork === undefined) {
        return null;
    }

    return firstWork;
}

function completeStartedDeterministicRun(context: FakeSupervisedChildRunContext, firstWork: WorkId): void {
    emitProcessUsageSamples(context);

    if (context.isKilled()) {
        return;
    }

    emitTestEnd(context, firstWork, 'pass');
    completeDeterministicSupervisedChild(context, 1);
}

function runDeterministicSupervisedChild(context: FakeSupervisedChildRunContext): void {
    const firstWork = assignedFirstWork(context);

    if (firstWork === null) {
        completeDeterministicSupervisedChild(context, 0);

        return;
    }

    emitTestStart(context, firstWork);

    if (context.testFile.includes('endless-loop')) {
        return;
    }

    if (emitProcessEnvironmentPolicyRun(context, firstWork)) {
        return;
    }

    completeStartedDeterministicRun(context, firstWork);
}

type DeterministicRunCoordinator = {
    readonly orchestrator: RunOrchestrator;
    readonly runDirectEntrypoint: RunCoordinator['runDirectEntrypoint'];
};

function createDeterministicRunCoordinatorWithDependencies(
    createSeed: () => bigint,
    createWorkerPool: RunOrchestratorDependencies['createWorkerPool']
): DeterministicRunCoordinator {
    const engine = createTestEngine();
    const wallClock = createClock();
    const environment: Record<string, string | undefined> = {};
    const reporterDispatcher = createReporterDispatcher({
        stderr: {
            writeLine() {
                return undefined;
            }
        },
        stdout: {
            writeLine() {
                return undefined;
            }
        },
        wallClock
    });

    const dependencies: RunOrchestratorDependencies = {
        ...deterministicRuntimeState(),
        collectBenchmarkHost: benchmarkHostSnapshot,
        availableParallelism: 4,
        createProcessUsageTracker: createDeterministicProcessUsageTracker,
        createSeed,
        createWorkerPool,
        defaultEngine: deterministicRunEngine(),
        async discoverRunFilesWithProjectRoot(request) {
            if (request.paths.length === 0 && request.profileFiles === null) {
                throw new Error('No run paths were provided and the selected profile has no file discovery policy.');
            }

            const files = request.paths.map(function toDiscoveredFile(file) {
                return discoveredFile(request.cwd, file);
            });
            const firstFile = files[0];

            if (firstFile === undefined) {
                throw new Error('Deterministic test discovery requires run paths.');
            }

            return {
                files: [ firstFile, ...files.slice(1) ],
                projectRoot: request.cwd
            };
        },
        execute: engine.execute,
        async loadRunEngineModule() {
            throw new Error('Deterministic test engine module loading is not configured.');
        },
        loadRunTestModules: createDeterministicRunTestModuleLoader({
            recordLoadEnvironmentMutation() {
                environment.OVERKILL_LOAD_POLICY_FIXTURE = 'after';
            }
        }),
        liveOutput: {
            stderr: {
                write() {
                    return undefined;
                }
            },
            stdout: {
                write() {
                    return undefined;
                }
            }
        },
        runtimeCapabilityPolicy: {
            observeIpcListeners: installNoPolicyRestriction,
            observeProcessExit: installNoPolicyRestriction,
            readEnvironment() {
                return environment;
            },
            readStorage() {
                return null;
            }
        },
        node: {
            arch: 'x64',
            platform: 'linux',
            version: '26.1.1'
        },
        reporterDispatcher,
        async startSupervisedChild() {
            return createFakeSupervisedChildProcess({
                collect: deterministicRunCollection,
                run(context) {
                    runDeterministicSupervisedChild(context);
                }
            });
        },
        startWorkerPoolHost() {
            throw new Error('Deterministic worker-pool host execution is not configured.');
        },
        wallClock
    };

    return createRunCoordinator(dependencies);
}

function createDeterministicRunCoordinatorWithSeed(
    createSeed: () => bigint
): DeterministicRunCoordinator {
    return createDeterministicRunCoordinatorWithDependencies(createSeed, createMissingWorkerPool);
}

export function createDeterministicRunOrchestratorWithSeed(createSeed: () => bigint): RunOrchestrator {
    return createDeterministicRunCoordinatorWithSeed(createSeed).orchestrator;
}

export function createDeterministicRunOrchestrator(): RunOrchestrator {
    return createDeterministicRunOrchestratorWithSeed(function createSeed() {
        return deterministicSeed;
    });
}

export function createDeterministicRunCoordinator(): DeterministicRunCoordinator {
    return createDeterministicRunCoordinatorWithSeed(function createSeed() {
        return deterministicSeed;
    });
}

export function createDeterministicWorkerPoolCollectionCoordinator(): DeterministicRunCoordinator {
    return createDeterministicRunCoordinatorWithDependencies(
        function createSeed() {
            return deterministicSeed;
        },
        createCollectionOnlyWorkerPool
    );
}
