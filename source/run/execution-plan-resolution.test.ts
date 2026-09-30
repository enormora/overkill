import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import { createCollectedExecutionPlan } from './run-collected-planning.ts';
import { RunExecutionPlanError } from './run-errors.ts';
import type { CollectedRunPlan } from './run-types.ts';
import {
    createWorkerPoolPlacementPlan,
    type WorkerPoolPlacementPlanInput
} from './worker-pool-placement-planning.ts';

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondIntegrationPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };
const fileSets = new Map([
    [ integrationPath, 'fast' ],
    [ secondIntegrationPath, 'slow' ]
]);

function collectedCase(
    title: string,
    params: string | null,
    suitePath: CollectedRunPlan['files'][number]['cases'][number]['suitePath']
): CollectedRunPlan['files'][number]['cases'][number] {
    return {
        annotations,
        controls,
        definitionLocations: [ { kind: 'unknown' } ],
        params,
        resourceAttachments: { directResources: [], resourceGraph: [], runtimeGraphs: [] },
        suitePath,
        testFamily: 'integration',
        title
    };
}

function createCollectedPlan(): CollectedRunPlan {
    return {
        defined: 2,
        discoveredFiles: [],
        files: [
            {
                cases: [ collectedCase('first', null, [ {
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: 'integration'
                } ]) ],
                file: integrationPath
            },
            {
                cases: [ collectedCase('second', '["slow"]', []) ],
                file: secondIntegrationPath
            }
        ],
        orphans: [],
        root: { annotations, controls, title: 'worker pool' }
    };
}

function fileSetForFile(file: string): string | null {
    return fileSets.get(file) ?? null;
}

function testFileHref(path: string): string {
    const url = new URL(path, import.meta.url);

    return url.href;
}

function createResourcePlan(
    handleTransport: 'local' | 'projected',
    includeInvalidDependency: boolean,
    scope: 'per-file' | 'per-run'
): CollectedRunPlan {
    const plan = createCollectedPlan();

    return {
        ...plan,
        files: plan.files.map(function attachResources(file) {
            return {
                ...file,
                cases: file.cases.map(function attachCaseResources(testCase) {
                    return {
                        ...testCase,
                        resourceAttachments: {
                            directResources: [ { key: 'shared', resourceName: 'shared' } ],
                            resourceGraph: [
                                ...includeInvalidDependency
                                    ? [ {
                                        dependencies: [],
                                        handleTransport: 'projected' as const,
                                        name: 'case-dependency',
                                        requirements: [],
                                        scenarios: [],
                                        scope: 'per-case'
                                    } ]
                                    : [],
                                {
                                    dependencies: includeInvalidDependency ? [ 'case-dependency' ] : [],
                                    handleTransport,
                                    name: 'shared',
                                    requirements: [],
                                    scenarios: [],
                                    scope
                                }
                            ],
                            runtimeGraphs: []
                        }
                    };
                })
            };
        })
    };
}

function createSameFileResourcePlan(handleTransport: 'local' | 'projected'): CollectedRunPlan {
    const plan = createResourcePlan(handleTransport, false, 'per-file');
    const [ firstFile, secondFile ] = plan.files;

    if (firstFile === undefined || secondFile === undefined) {
        throw new Error('Same-file resource plan requires two files.');
    }

    return {
        ...plan,
        files: [ { ...firstFile, cases: [ ...firstFile.cases, ...secondFile.cases ] } ]
    };
}

function workerPoolPlacementInput(
    selectedPlan: CollectedRunPlan
): WorkerPoolPlacementPlanInput {
    return {
        assignmentPolicy: 'case-count-balanced',
        availableParallelism: 3,
        fileSetForFile,
        order: 'plan',
        profileMaximumWorkers: null,
        requestedWorkers: null,
        scheduling: 'concurrent',
        seed: { value: 1n },
        selectedPlan,
        workerLifecycle: 'reuse',
        workDistribution: { mode: 'file' }
    };
}

function capturePlanError(run: () => unknown): RunExecutionPlanError | null {
    try {
        run();
        return null;
    } catch (error: unknown) {
        return error instanceof RunExecutionPlanError ? error : null;
    }
}

async function captureAsyncPlanError(run: () => Promise<unknown>): Promise<RunExecutionPlanError | null> {
    try {
        await run();
        return null;
    } catch (error: unknown) {
        return error instanceof RunExecutionPlanError ? error : null;
    }
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/execution-plan-resolution.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'placement resolution aggregates incompatible resource plans',
            body(scope: OverkillScope) {
                const error = capturePlanError(function resolveIncompatiblePlan() {
                    createWorkerPoolPlacementPlan(workerPoolPlacementInput(
                        createResourcePlan('local', true, 'per-run')
                    ));
                });

                if (error === null) {
                    throw new Error('Expected incompatible worker-pool plan.');
                }

                scope.assert.equal(error.name, 'RunExecutionPlanError');
                scope.assert.equal(error.code(), 'invalid-request');
                scope.assert.deepEqual(
                    error.conflicts().map(function conflictKind(conflict) {
                        return conflict.kind;
                    }),
                    [ 'resource-dependency-scope', 'resource-projection-required' ]
                );
                scope.assert.true(Object.isFrozen(error.conflicts()));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'projected run resources receive frozen infrastructure ownership',
            body(scope: OverkillScope) {
                const placement = createWorkerPoolPlacementPlan(workerPoolPlacementInput(
                    createResourcePlan('projected', false, 'per-run')
                ));
                const owner = placement.resourceOwnership.owners[0];

                scope.assert.equal(owner?.placement.kind, 'infrastructure-worker');
                scope.assert.equal(owner?.resourceName, 'shared');
                scope.assert.equal(owner?.scope, 'per-run');
                scope.assert.equal(owner?.work.length, 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'supervised planning rejects invalid resource dependencies before execution',
            async body(scope: OverkillScope) {
                const error = await captureAsyncPlanError(async function resolveIncompatiblePlan() {
                    await createCollectedExecutionPlan({
                        collectedPlan: createResourcePlan('projected', true, 'per-run'),
                        dependencies: fakeWorkerPoolRuntimeDependencies(),
                        durationHistoryIndex: null,
                        files: [ {
                            file: integrationPath,
                            fileSet: null,
                            href: testFileHref(integrationPath),
                            path: integrationPath
                        } ],
                        planKind: 'supervised',
                        profile: defaultIntegrationProfile({
                            execution: { processModel: 'supervised-process' }
                        }),
                        request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
                    });
                });

                if (error === null) {
                    throw new Error('Expected incompatible supervised plan.');
                }

                scope.assert.deepEqual(
                    error.conflicts().map(function conflictKind(conflict) {
                        return conflict.kind;
                    }),
                    [ 'resource-dependency-scope' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'fresh case workers require projected file resource handles',
            body(scope: OverkillScope) {
                const localError = capturePlanError(function resolveLocalFileResource() {
                    createWorkerPoolPlacementPlan({
                        ...workerPoolPlacementInput(createSameFileResourcePlan('local')),
                        workerLifecycle: 'fresh-worker-per-unit',
                        workDistribution: { mode: 'case' }
                    });
                });
                const projectedPlan = createWorkerPoolPlacementPlan({
                    ...workerPoolPlacementInput(createSameFileResourcePlan('projected')),
                    workerLifecycle: 'fresh-worker-per-unit',
                    workDistribution: { mode: 'case' }
                });

                scope.assert.equal(localError?.conflicts()[0]?.kind, 'resource-projection-required');
                scope.assert.equal(
                    projectedPlan.resourceOwnership.owners[0]?.placement.kind,
                    'infrastructure-worker'
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
