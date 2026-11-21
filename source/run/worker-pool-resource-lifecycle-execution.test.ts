import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import type { WorkId } from '../packages/engine/engine.entry-point.ts';
import type { ResourceScope } from '../resources/resources.ts';
import { createCollectedPlan, fakeWorkerRuntime, createTaskRun } from '../test-support/worker-pool-execution-state.ts';
import { createResourceOwnershipPlan } from './execution-plan-resolution.ts';
import {
    acquireWorkerPoolResourceLifecycle,
    disposeWorkerPoolResourceLifecycles,
    createResourcePreparationChannel
} from './worker-pool-resource-lifecycle-execution.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import type {
    WorkerPoolMessage,
    WorkerPoolPreparationReply,
    WorkerPoolMessageChannel
} from './worker-pool-protocol.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type PlacementPlan = NonNullable<WorkerPoolRunRuntime['resolvedRun']['facts']['execution']['placementPlan']>;
type ResourceSummary =
    CollectedRunPlan['files'][number]['cases'][number]['resourceAttachments']['resourceGraph'][number];

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

function resource(name: string, scope: ResourceScope): ResourceSummary {
    return {
        workload: 'independent' as const,
        dependencies: [],
        handleTransport: 'local',
        name,
        requirements: [],
        scenarios: [],
        scope
    };
}

function collectedPlanWithResources(resourceGraph: readonly ResourceSummary[]): CollectedRunPlan {
    const collectedPlan = createCollectedPlan();
    const firstFile = collectedPlan.files[0];
    const firstCase = firstFile?.cases[0];

    if (firstFile === undefined || firstCase === undefined) {
        throw new Error('Collected plan fixture requires one file-backed case.');
    }

    return {
        ...collectedPlan,
        files: [
            {
                ...firstFile,
                cases: [
                    {
                        ...firstCase,
                        resourceAttachments: {
                            ...firstCase.resourceAttachments,
                            directResources: resourceGraph.map(function directResource(resourceValue) {
                                return { key: resourceValue.name, resourceName: resourceValue.name };
                            }),
                            resourceGraph
                        }
                    }
                ]
            }
        ]
    };
}

function placementPlan(runtime: WorkerPoolRunRuntime): PlacementPlan {
    const plan = runtime.resolvedRun.facts.execution.placementPlan;

    if (plan === null) {
        throw new Error('Worker-pool runtime fixture requires a placement plan.');
    }

    return {
        ...plan,
        resourceOwnership: createResourceOwnershipPlan({
            lanes: plan.lanes,
            selectedPlan: runtime.collectedPlan,
            units: plan.units
        })
    };
}

function runtimeWithPoolRun(
    collectedPlan: CollectedRunPlan,
    run: WorkerPoolRunRuntime['pool']['run']
): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(collectedPlan);

    return {
        ...runtime,
        pool: {
            ...runtime.pool,
            run
        }
    };
}

function readTaskKind(task: unknown): string {
    const kind: unknown = typeof task === 'object' && task !== null ? Reflect.get(task, 'kind') : null;

    if (typeof kind !== 'string') {
        throw new TypeError('Expected a worker-pool task kind.');
    }

    return kind;
}

function readTaskLane(task: unknown): string {
    const lane: unknown = typeof task === 'object' && task !== null ? Reflect.get(task, 'lane') : null;

    if (typeof lane !== 'string') {
        throw new TypeError('Expected a worker-pool task lane.');
    }

    return lane;
}

const assertInvalidRunResourceOutputIsRejected = defineCompositeAssertion({
    name: 'invalid run resource output is rejected',
    async assert(check) {
        const runtime = runtimeWithPoolRun(
            collectedPlanWithResources([ resource('database', 'per-run') ]),
            async function runInvalidResourceTask() {
                return { invalid: true };
            }
        );
        return check.group([
            await check.rejects(async function acquireInvalidRunResources() {
                await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));
            }, { message: 'Worker-pool run resource task returned an invalid result.' })
        ]);
    }
});

const assertRunResourceDisposalFailureRecordsRunnerError = defineCompositeAssertion({
    name: 'run resource disposal failure records runner error',
    async assert(check) {
        const runtime = runtimeWithPoolRun(
            collectedPlanWithResources([ resource('database', 'per-run') ]),
            async function runResourceTask(task) {
                if (readTaskKind(task) === 'acquire-run-resources') {
                    return { projectedResources: { resources: [] }, runnerErrors: [] };
                }

                throw new Error('dispose failed');
            }
        );
        const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));
        await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), lifecycle);
        return check.group([ check.equal(
            runtime.runState.runnerErrors()[0]?.message,
            'Worker-pool run resource disposal failed.'
        ) ]);
    }
});

function preparationRuntime(
    output: unknown,
    ownsResources: boolean,
    recordTask: (kind: string) => void
): WorkerPoolRunRuntime {
    const runtime = runtimeWithPoolRun(
        collectedPlanWithResources(ownsResources ? [ resource('database', 'per-run') ] : []),
        async function prepareResources(task) {
            recordTask(readTaskKind(task));
            if (output instanceof Error) {
                throw output;
            }
            return output;
        }
    );
    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: { ...runtime.resolvedRun.facts.execution, placementPlan: placementPlan(runtime) }
            }
        }
    };
}
const preparationResponseChecks = (
    check: CompositeCheckBuilder<'assert'>,
    reply: WorkerPoolPreparationReply,
    failed: boolean
): CompositeAssertionReturn<'assert'> => {
    const initialChecks = check.group([
        check.equal(reply.kind, 'resource-artifacts-prepared'),
        check.equal(reply.request, 'request-2')
    ]);
    if (failed) {
        return check.group([
            initialChecks,
            check.equal(reply.runnerErrors.length, 1),
            check.equal(reply.runnerErrors[0]?.subtype, 'artifact'),
            check.equal(reply.runnerErrors[0]?.attributedToAttempt?.index, 2)
        ]);
    } else {
        return check.group([ initialChecks, check.deepEqual(reply.runnerErrors, []) ]);
    }
};

type PreparationExchange = {
    readonly reply: WorkerPoolPreparationReply;
    readonly received: readonly WorkerPoolMessage[];
};
async function exchangePreparationMessages(
    channel: WorkerPoolMessageChannel,
    work: WorkId,
    received: readonly WorkerPoolMessage[]
): Promise<PreparationExchange> {
    const response = new Promise<WorkerPoolPreparationReply>(function receiveReply(resolve) {
        channel.port.once('message', resolve);
    });
    channel.port.postMessage(
        { kind: 'prepare-resource-artifacts', request: 'request-2', work, attempt: { index: 2 } },
        []
    );
    const reply = await response;
    channel.port.postMessage({ kind: 'task-messages-completed' }, []);
    await channel.messagesCompleted;
    return { reply, received };
}
async function collectPreparationReply(
    cleanup: TestScope['cleanup'],
    runtime: WorkerPoolRunRuntime
): Promise<PreparationExchange> {
    const received: WorkerPoolMessage[] = [];
    const taskRun = createTaskRun(createSupervisedRunState('all'));
    const channel = createResourcePreparationChannel(taskRun, runtime, function receive(message) {
        received.push(message);
    });
    cleanup(channel.close);
    const work = taskRun.members[0].unit.work[0];
    if (work === undefined) {
        throw new Error('Expected preparation work.');
    }
    return await exchangePreparationMessages(channel, work, received);
}
const assertPreparationReply = defineCompositeAssertion({
    name: 'preparation reply',
    async assert(check, registerCleanup: TestScope['cleanup'], output: unknown, ownsResources: boolean) {
        const calls: string[] = [];
        const runtime = preparationRuntime(output, ownsResources, function recordTask(kind) {
            calls.push(kind);
        });
        const { reply, received } = await collectPreparationReply(registerCleanup, runtime);
        return check.group([
            check.deepEqual(received, [ { kind: 'task-messages-completed' } ]),
            preparationResponseChecks(
                check.annotated('preparation response'),
                reply,
                ownsResources && (output === null || output instanceof Error)
            ),
            check.deepEqual(calls, ownsResources ? [ 'prepare-resource-artifacts' ] : [])
        ]);
    }
});

export const testNode = suite({
    ...testCaseMetadata,
    title: 'Worker pool resource lifecycle execution',
    children: [
        table({
            ...testCaseMetadata,
            title: 'resource preparation replies preserve request identity',
            cases: [ { description: 'successful response', input: { runnerErrors: [] } }, {
                description: 'missing response',
                input: null
            }, { description: 'disconnected owner', input: new Error('owner disconnected') } ],
            caseTitle({ description }) {
                return description;
            },
            async test(scope) {
                const output = scope.parameters.input;

                await scope.assert(assertPreparationReply, scope.cleanup, output, true);
                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'preparation without an external owner replies without scheduling a task',
            async body(scope) {
                await scope.assert(assertPreparationReply, scope.cleanup, null, false);
                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool per-run resources acquire through the owner lane',
            async body(scope) {
                const perRunResourcesUseOwnerRuntime = runtimeWithPoolRun(
                    collectedPlanWithResources([ resource('database', 'per-run') ]),
                    async function runResourceTask(task) {
                        scope.assert.equal(readTaskKind(task), 'acquire-run-resources');

                        return {
                            projectedResources: {
                                resources: [ { boundaryKey: 'run:database', payload: 'database-handle' } ]
                            },
                            runnerErrors: []
                        };
                    }
                );
                const perRunResourcesUseOwnerLifecycle = await acquireWorkerPoolResourceLifecycle(
                    perRunResourcesUseOwnerRuntime,
                    placementPlan(perRunResourcesUseOwnerRuntime)
                );

                scope.assert.equal(perRunResourcesUseOwnerLifecycle.resourceOwner, true);
                scope.assert.deepEqual(perRunResourcesUseOwnerLifecycle.projectedResources, {
                    resources: [ { boundaryKey: 'run:database', payload: 'database-handle' } ]
                });

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool per-run resource acquisition rejects invalid worker output',
            async body(scope) {
                await scope.assert(assertInvalidRunResourceOutputIsRejected);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool lane resources dispose each lane lifecycle',
            async body(scope) {
                const laneResourceDisposalRunsOnEachLaneDisposedLanes: string[] = [];
                const laneResourceDisposalRunsOnEachLaneRuntime = runtimeWithPoolRun(
                    collectedPlanWithResources([ resource('scratch', 'per-case') ]),
                    async function runDisposeTask(task) {
                        scope.assert.equal(readTaskKind(task), 'dispose-lane-lifecycle');
                        laneResourceDisposalRunsOnEachLaneDisposedLanes.push(readTaskLane(task));

                        return { runnerErrors: [] };
                    }
                );
                const laneResourceDisposalRunsOnEachLaneLifecycle = await acquireWorkerPoolResourceLifecycle(
                    laneResourceDisposalRunsOnEachLaneRuntime,
                    placementPlan(laneResourceDisposalRunsOnEachLaneRuntime)
                );

                await disposeWorkerPoolResourceLifecycles(
                    laneResourceDisposalRunsOnEachLaneRuntime,
                    placementPlan(laneResourceDisposalRunsOnEachLaneRuntime),
                    laneResourceDisposalRunsOnEachLaneLifecycle
                );

                scope.assert.deepEqual(laneResourceDisposalRunsOnEachLaneDisposedLanes, [ 'worker-1' ]);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool run resource disposal records runner errors',
            async body(scope) {
                await scope.assert(assertRunResourceDisposalFailureRecordsRunnerError);

                return scope.assert.collect();
            }
        })
    ]
});
