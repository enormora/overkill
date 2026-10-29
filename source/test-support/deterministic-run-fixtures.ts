import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import type {
    RunProcessUsage,
    ProcessUsageSnapshot,
    RunProcessUsageTracker,
    RunResult,
    TestNode,
    TestScope
} from '../packages/engine/engine.entry-point.ts';
import {
    collectedRunPlanFromTestPlan,
    createRunResultFromCollectedPlan
} from '../run/collected-run-plan.ts';
import { defaultRunEngine } from '../run/default-run-engine.ts';
import { RunCollectionError } from '../run/run-errors.ts';
import { createRunTestModuleLoader, type RunTestModuleLoader } from '../run/run-test-modules.ts';
import type {
    CollectedRunPlan,
    RunCollectionRoot,
    WorkId
} from '../run/run-types.ts';
import type { SupervisedChildCommand } from '../run/supervised-protocol.ts';
import { createMemoryHistoryStorage } from './memory-history-storage.ts';

const deterministicRunFixturePaths = {
    emptySuite: 'source/integration-tests/run/fixtures/empty-suite.test.ts',
    customEnginePassing: 'source/integration-tests/run/fixtures/custom-engine-passing.test.ts',
    loadEnvPolicy: 'source/integration-tests/run/fixtures/load-env-policy.test.ts',
    microtestCaptureControls: 'source/integration-tests/run/fixtures/microtest-capture-controls.test.ts',
    passing: 'source/integration-tests/run/fixtures/passing.test.ts',
    selection: 'source/integration-tests/run/fixtures/selection.test.ts',
    throwsOnImport: 'source/integration-tests/run/fixtures/throws-on-import.test.ts'
};

export type DeterministicRunCollection = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly [];
};

type DeterministicRunCollectionInput = {
    readonly command: SupervisedChildCommand;
    readonly file: string;
};

export function deterministicRunEngine(): typeof defaultRunEngine {
    return defaultRunEngine;
}

type DeterministicRunTestModuleLoaderInput = {
    readonly recordLoadEnvironmentMutation: () => void;
};

function deterministicCaseTitle(file: string): string {
    if (file === deterministicRunFixturePaths.customEnginePassing) {
        return 'custom engine passes';
    }

    if (file.includes('endless-loop')) {
        return 'loops';
    }

    if (file.includes('delayed-pass')) {
        return 'delays';
    }

    if (file.includes('env-policy')) {
        return 'mutates environment';
    }

    return 'passes';
}

function assertValidDeterministicModuleCollection(input: DeterministicRunCollectionInput): void {
    if (input.command.engine.kind !== 'module') {
        return;
    }

    if (
        input.command.engine.exportName === 'invalidEngine' ||
        input.command.engine.exportName === 'getAsyncEngine'
    ) {
        throw new RunCollectionError('Custom engine module export must be an Engine.', {
            cause: new Error('Custom engine module export must be an Engine.')
        }, 'loader');
    }

    if (input.file === deterministicRunFixturePaths.passing) {
        const message =
            `Test module testNode must be created by the selected engine: ${deterministicRunFixturePaths.passing}`;

        throw new RunCollectionError(
            message,
            {
                cause: new Error(message)
            },
            'loader'
        );
    }
}

function pass(scope: TestScope): ReturnType<TestScope['assert']['collect']> {
    scope.assert.true(true, { message: 'passes' });

    return scope.assert.collect();
}

function passingFixtureTestNode(): TestNode {
    return defaultRunEngine.createSuite({
        definitionLocations: [ { kind: 'unknown' } ],
        annotations: {},
        controls: {},
        children: [
            defaultRunEngine.createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                annotations: { tags: [ 'fast' ] },
                controls: {},
                title: 'passes',
                body: pass
            })
        ],
        title: 'fixture'
    });
}

function microtestCaptureControlsFixtureTestNode(): TestNode {
    return defaultRunEngine.createSuite({
        definitionLocations: [ { kind: 'unknown' } ],
        annotations: {},
        controls: { capture: 'live' },
        children: [
            defaultRunEngine.createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                annotations: {},
                controls: {},
                title: 'passes',
                body: pass
            })
        ],
        title: 'fixture'
    });
}

function selectionFixtureTestNode(): TestNode {
    return defaultRunEngine.createSuite({
        definitionLocations: [ { kind: 'unknown' } ],
        annotations: {},
        controls: {},
        children: [
            defaultRunEngine.createSuite({
                definitionLocations: [ { kind: 'unknown' } ],
                annotations: {},
                controls: {},
                children: [
                    defaultRunEngine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' } ],
                        annotations: { ownership: [ '@Payments' ], tags: [ 'Fast' ] },
                        controls: {},
                        title: 'charges card',
                        body: pass
                    }),
                    defaultRunEngine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' } ],
                        annotations: { ownership: [ '@Payments' ], tags: [ 'Slow' ] },
                        controls: {},
                        title: 'refunds card',
                        body: pass
                    })
                ],
                title: 'payments'
            }),
            defaultRunEngine.createTable({
                definitionLocations: [ { kind: 'unknown' } ],
                annotations: {},
                controls: {},
                cases: [
                    {
                        annotations: { ownership: [ '@Search' ], tags: [ 'Search' ] },
                        controls: {},
                        parameters: { query: 'Alpha' },
                        title: 'query row',
                        body: pass
                    },
                    {
                        annotations: { ownership: [ '@Other' ], tags: [ 'Other' ] },
                        controls: {},
                        parameters: { query: 'Beta' },
                        title: 'other query row',
                        body: pass
                    }
                ],
                title: 'search rows'
            })
        ],
        title: 'selection fixture'
    });
}

function emptySuiteFixtureTestNode(): TestNode {
    return defaultRunEngine.createSuite({
        definitionLocations: [ { kind: 'unknown' } ],
        annotations: {},
        controls: {},
        children: [],
        title: 'empty'
    });
}

function defaultFixtureTestNode(file: string): TestNode {
    return defaultRunEngine.createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        annotations: {},
        controls: {},
        title: deterministicCaseTitle(file),
        body: pass
    });
}

function deterministicRunTestNode(file: string): TestNode {
    if (file === deterministicRunFixturePaths.passing) {
        return passingFixtureTestNode();
    }

    if (file === deterministicRunFixturePaths.microtestCaptureControls) {
        return microtestCaptureControlsFixtureTestNode();
    }

    if (file === deterministicRunFixturePaths.selection) {
        return selectionFixtureTestNode();
    }

    if (file === deterministicRunFixturePaths.emptySuite) {
        return emptySuiteFixtureTestNode();
    }

    return defaultFixtureTestNode(file);
}

export function createDeterministicRunTestModuleLoader(
    input: DeterministicRunTestModuleLoaderInput
): RunTestModuleLoader {
    return createRunTestModuleLoader({
        async importModule(href) {
            const file = href.replace(/^virtual:/u, '');

            if (file === deterministicRunFixturePaths.throwsOnImport) {
                throw new Error('fixture import failed');
            }

            if (file === deterministicRunFixturePaths.loadEnvPolicy) {
                input.recordLoadEnvironmentMutation();
            }

            return { testNode: deterministicRunTestNode(file) };
        }
    });
}

export const loadDeterministicRunTestModules: RunTestModuleLoader = createDeterministicRunTestModuleLoader({
    recordLoadEnvironmentMutation() {
        return undefined;
    }
});

export function deterministicCollectedRunPlan(
    file: string,
    root: RunCollectionRoot = { annotations: {}, controls: {}, title: '/project' }
): CollectedRunPlan {
    return collectedRunPlanFromTestPlan(defaultRunEngine.createTestPlanFromTestFiles({
        files: [ { file, testNode: deterministicRunTestNode(file) } ],
        root
    }));
}

export function createDeterministicRunResult(
    collectedPlan: CollectedRunPlan,
    work: readonly WorkId[],
    processUsage: RunProcessUsage
): RunResult {
    return createRunResultFromCollectedPlan(
        collectedPlan,
        work.map(function toPassingResult(entry) {
            return {
                property: null,
                benchmark: null,
                attempts: [ {
                    property: null,
                    benchmark: null,
                    attempt: { index: 0 },
                    durationMicroseconds: 0,
                    outcome: { kind: 'pass' as const },
                    verdict: 'pass' as const
                } ],
                retried: null,
                definitionLocations: [ { kind: 'unknown' as const } ],
                durationMicroseconds: 0,
                id: entry.case,
                outcome: { kind: 'pass' as const },
                verdict: 'pass' as const,
                workId: entry
            };
        }),
        [],
        {
            completedAtMicroseconds: 0,
            planStatus: 'planned',
            processUsage,
            startedAtMicroseconds: 0,
            testExecutionWallTimeMicroseconds: 0
        }
    );
}

export function deterministicRunCollection(input: DeterministicRunCollectionInput): DeterministicRunCollection {
    assertValidDeterministicModuleCollection(input);

    const { file } = input;

    if (file === deterministicRunFixturePaths.throwsOnImport) {
        throw new RunCollectionError(`Failed to load test module: ${deterministicRunFixturePaths.throwsOnImport}`, {
            cause: new Error('fixture import failed')
        }, 'loader');
    }

    if (file === deterministicRunFixturePaths.emptySuite) {
        throw new RunCollectionError('Failed to collect tests from run inputs.', {
            cause: new Error('No tests were collected from run inputs.')
        }, 'loader');
    }

    return {
        collectedPlan: deterministicCollectedRunPlan(file, input.command.root),
        runnerErrors: []
    };
}

export const sampledActiveResourceCount = 2;
export const sampledResidentSetBytes = 10;

export function processUsageSample(
    activeResourceCount: number,
    capturedAtMicroseconds: number,
    residentSetBytes: number
): ProcessUsageSnapshot {
    return {
        activeResourceCount,
        activeResourceTypes: [],
        capturedAtMicroseconds,
        javaScriptEngineHeapBytes: 1,
        residentSetBytes
    };
}

export function deterministicProcessUsage(): RunProcessUsage {
    return {
        activeResourceTypes: [],
        end: processUsageSample(1, 1, sampledResidentSetBytes),
        peakActiveResourceCount: sampledActiveResourceCount,
        peakJavaScriptEngineHeapBytes: 1,
        peakResidentSetBytes: sampledResidentSetBytes,
        peakResidentSetGrowthBytesPerSecond: 9,
        sampleCount: sampledActiveResourceCount,
        start: processUsageSample(1, 0, 1)
    };
}

export function createDeterministicProcessUsageTracker(): RunProcessUsageTracker {
    return {
        finish() {
            return {
                activeResourceTypes: [],
                end: {
                    activeResourceCount: 0,
                    activeResourceTypes: [],
                    capturedAtMicroseconds: 1,
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
                    capturedAtMicroseconds: 0,
                    javaScriptEngineHeapBytes: 1,
                    residentSetBytes: 2
                }
            };
        },
        start() {
            return undefined;
        }
    };
}

export function deterministicRuntimeState(): Pick<
    RunOrchestratorDependencies,
    'createHistoryStorage' | 'runtimeStateStore'
> {
    return { createHistoryStorage: createMemoryHistoryStorage, runtimeStateStore: createMemoryHistoryStorage() };
}
