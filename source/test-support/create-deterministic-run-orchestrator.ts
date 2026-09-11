import { createWallClock, type WallClock } from '@enormora/wall-clock';
import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { ResourceUsageSnapshot, RunResourceUsage, RunResourceUsageTracker } from '../engine/run-result.ts';
import {
    createRunResultFromCollectedPlan
} from '../run/collected-run-plan.ts';
import { createRunOrchestrator } from '../run/run.ts';
import type { CollectedRunPlan, RunOrchestrator } from '../run/run-types.ts';
import {
    createFakeSupervisedChildProcess,
    type FakeSupervisedChildRunContext
} from './fake-supervised-child-process.ts';
import { createTestEngine } from './create-test-engine.ts';
import {
    createDeterministicRunTestModuleLoader,
    deterministicCollectedRunPlan,
    deterministicRunCollection,
    deterministicRunEngine
} from './deterministic-run-fixtures.ts';

const deterministicSeed = 99n;
const sampledActiveResourceCount = 2;
const sampledResidentSetBytes = 10;

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

function resourceUsageSample(
    activeResourceCount: number,
    capturedAtMilliseconds: number,
    residentSetBytes: number
): ResourceUsageSnapshot {
    return {
        activeResourceCount,
        activeResourceTypes: [],
        capturedAtMilliseconds,
        javaScriptEngineHeapBytes: 1,
        residentSetBytes
    };
}

function deterministicResourceUsage(): RunResourceUsage {
    return {
        activeResourceTypes: [],
        end: resourceUsageSample(1, 1, sampledResidentSetBytes),
        peakActiveResourceCount: sampledActiveResourceCount,
        peakJavaScriptEngineHeapBytes: 1,
        peakResidentSetBytes: sampledResidentSetBytes,
        peakResidentSetGrowthBytesPerSecond: 9,
        sampleCount: sampledActiveResourceCount,
        start: resourceUsageSample(1, 0, 1)
    };
}

function emitTestStart(context: FakeSupervisedChildRunContext): void {
    const [ testCase ] = context.assignment.assignedCases;

    if (testCase === undefined) {
        context.emitExit();

        return;
    }

    context.emitMessage({
        event: {
            attempt: 1,
            case: testCase,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-start',
            suitePath: []
        },
        kind: 'event'
    });
}

function emitTestEnd(context: FakeSupervisedChildRunContext, verdict: 'pass' | 'runtime-policy'): void {
    const [ testCase ] = context.assignment.assignedCases;

    if (testCase === undefined) {
        return;
    }

    context.emitMessage({
        event: {
            attempt: 1,
            artifacts: [],
            case: testCase,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-end',
            outcome: verdict === 'pass' ? { kind: 'pass' } : null,
            suitePath: [],
            verdict,
            wallTimeMs: 0
        },
        kind: 'event'
    });
}

function emitProcessEnvironmentPolicyError(context: FakeSupervisedChildRunContext): void {
    const [ testCase ] = context.assignment.assignedCases;

    if (testCase === undefined) {
        return;
    }

    context.emitMessage({
        event: {
            error: {
                attributedTo: testCase,
                cause: { capability: 'process-env' },
                message: 'Runtime policy violation: process.env value was set: OVERKILL_CASE_POLICY_FIXTURE.',
                subtype: 'runtime-policy'
            },
            kind: 'runner-error'
        },
        kind: 'event'
    });
}

function emitProcessEnvironmentPolicyRun(context: FakeSupervisedChildRunContext): boolean {
    if (!context.testFile.includes('env-policy')) {
        return false;
    }

    emitProcessEnvironmentPolicyError(context);
    emitTestEnd(context, 'runtime-policy');
    context.emitExit();

    return true;
}

function emitResourceUsageSamples(context: FakeSupervisedChildRunContext): void {
    context.emitSample(resourceUsageSample(1, 0, 1));
    context.emitSample(resourceUsageSample(sampledActiveResourceCount, 1, sampledResidentSetBytes));
}

function collectedCaseIdentity(file: string, testCase: CollectedRunPlan['files'][number]['cases'][number]): string {
    return caseIdentityKey({
        file,
        params: testCase.params,
        suite: testCase.suitePath.map(function toSuiteTitle(suite) {
            return suite.title;
        }),
        title: testCase.title
    });
}

function collectedPlanForAssignedCases(
    collectedPlan: CollectedRunPlan,
    assignedCases: readonly CaseId[]
): CollectedRunPlan {
    const assignedCaseKeys = new Set(assignedCases.map(caseIdentityKey));

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

function completeDeterministicSupervisedChild(context: FakeSupervisedChildRunContext, wallClock: WallClock): void {
    const collectedPlan = deterministicCollectedRunPlan(context.testFile);

    emitTestEnd(context, 'pass');
    context.emitMessage({
        kind: 'result',
        result: createRunResultFromCollectedPlan(
            collectedPlanForAssignedCases(collectedPlan, context.assignment.assignedCases),
            context.assignment.assignedCases.map(function toPassingResult(testCase) {
                return {
                    id: testCase,
                    outcome: { kind: 'pass' as const },
                    verdict: 'pass' as const
                };
            }),
            [],
            {
                resourceUsage: deterministicResourceUsage(),
                startedAtMs: 0,
                wallClock
            }
        )
    });
    context.emitExit();
}

function runDeterministicSupervisedChild(context: FakeSupervisedChildRunContext, wallClock: WallClock): void {
    emitTestStart(context);

    if (context.testFile.includes('endless-loop')) {
        return;
    }

    if (emitProcessEnvironmentPolicyRun(context)) {
        return;
    }

    emitResourceUsageSamples(context);

    if (context.isKilled()) {
        return;
    }

    completeDeterministicSupervisedChild(context, wallClock);
}

export function createDeterministicRunOrchestratorWithSeed(createSeed: () => bigint): RunOrchestrator {
    const engine = createTestEngine();
    const wallClock = createWallClock();
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

    return createRunOrchestrator({
        createResourceUsageTracker(): RunResourceUsageTracker {
            return {
                finish() {
                    return {
                        activeResourceTypes: [],
                        end: {
                            activeResourceCount: 0,
                            activeResourceTypes: [],
                            capturedAtMilliseconds: 1,
                            javaScriptEngineHeapBytes: 2,
                            residentSetBytes: 3
                        },
                        peakActiveResourceCount: 0,
                        peakJavaScriptEngineHeapBytes: 2,
                        peakResidentSetBytes: 3,
                        peakResidentSetGrowthBytesPerSecond: 0,
                        sampleCount: 2,
                        start: {
                            activeResourceCount: 0,
                            activeResourceTypes: [],
                            capturedAtMilliseconds: 0,
                            javaScriptEngineHeapBytes: 1,
                            residentSetBytes: 2
                        }
                    };
                },
                start() {
                    return undefined;
                }
            };
        },
        createSeed,
        createWorkerPool: createMissingWorkerPool,
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
            installIpcRestriction: installNoPolicyRestriction,
            installProcessExecutionRestriction: installNoPolicyRestriction,
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
                    runDeterministicSupervisedChild(context, wallClock);
                }
            });
        },
        wallClock
    });
}

export function createDeterministicRunOrchestrator(): RunOrchestrator {
    return createDeterministicRunOrchestratorWithSeed(function createSeed() {
        return deterministicSeed;
    });
}
