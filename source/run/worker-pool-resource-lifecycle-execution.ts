import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { workIdentityKey, type AttemptId, type WorkId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { workerPoolPlacementPlan, type WorkerPoolTaskRun, type WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import type { PlacementPlan } from './run-types.ts';
import {
    createBatchRunCommand,
    createRunCommand,
    firstPlanUnit,
    placementRunWork
} from './worker-pool-command.ts';
import type { WorkerPoolLeaseMember } from './worker-pool-dispatch-state.ts';
import {
    createWorkerPoolMessageChannel,
    type WorkerPoolPrepareResourcesTask,
    type WorkerPoolMessage,
    type WorkerPoolMessageChannel,
    workerPoolRunResourceOwnerLane,
    type WorkerPoolCommand,
    type WorkerPoolDisposeResourceOutput,
    type WorkerPoolRunResourceOutput
} from './worker-pool-protocol.ts';

type WorkerPoolTaskChannel = {
    readonly close: () => void;
    readonly port: NodeMessagePort;
};

type StartedCaseLedger = {
    readonly has: (caseKey: string) => boolean;
};

type CompletedWorkLedger = {
    readonly add: (key: string) => unknown;
    readonly has: (key: string) => boolean;
};

export type WorkerPoolResourceLifecycle = {
    readonly completedWork: CompletedWorkLedger;
    readonly ownerBoundaryKeysByWork: ReadonlyMap<string, readonly string[]>;
    readonly ownerLane: string | null;
    readonly projectionBoundaryKeysByWork: ReadonlyMap<string, readonly string[]>;
    readonly projectedResources: WorkerPoolRunResourceOutput['projectedResources'];
    readonly resourceOwner: boolean;
    readonly runWork: ReturnType<typeof placementRunWork>;
};

function externallyOwnedResources(plan: PlacementPlan): PlacementPlan['resourceOwnership']['owners'] {
    return plan.resourceOwnership.owners.filter(function hasExternalOwner(owner) {
        return owner.scope === 'per-run' || owner.placement.kind === 'infrastructure-worker';
    });
}

function resourceOwnerLane(plan: PlacementPlan): string | null {
    const owners = externallyOwnedResources(plan);

    if (owners.length === 0) {
        return null;
    }

    if (
        owners.some(function usesInfrastructureWorker(owner) {
            return owner.placement.kind === 'infrastructure-worker';
        })
    ) {
        return workerPoolRunResourceOwnerLane;
    }

    const placement = owners[0]?.placement;

    return placement?.kind === 'executor-lane' ? placement.lane : null;
}

function ownerWork(plan: PlacementPlan): readonly WorkId[] {
    const workByKey = new Map(
        externallyOwnedResources(plan).flatMap(function ownerWorkEntries(owner) {
            return owner.work.map(function ownerWorkEntry(work) {
                return [ workIdentityKey(work), work ] as const;
            });
        })
    );

    return Array.from(workByKey.values());
}

function boundaryKeysByWork(
    plan: PlacementPlan,
    includePerRun: boolean
): ReadonlyMap<string, readonly string[]> {
    const keys = new Map<string, string[]>();

    for (const owner of externallyOwnedResources(plan)) {
        if (includePerRun || owner.scope !== 'per-run') {
            for (const work of owner.work) {
                const workKey = workIdentityKey(work);
                const workKeys = keys.get(workKey) ?? [];

                workKeys.push(owner.boundaryKey);
                keys.set(workKey, workKeys);
            }
        }
    }

    return keys;
}

function ownerCommand(
    runtime: WorkerPoolRunRuntime,
    plan: PlacementPlan,
    work: readonly WorkId[]
): WorkerPoolCommand {
    const command = createRunCommand(runtime, firstPlanUnit(plan));

    return {
        ...command,
        paths: Array.from(
            new Set(work.flatMap(function ownerWorkPath(item) {
                return item.case.file === null ? [] : [ item.case.file ];
            }))
        ),
        workerLifecycle: 'reuse' as const
    };
}

function portTransferList(port: NodeMessagePort): readonly NodeMessagePort[] {
    return [ port ];
}

function freshSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function isWorkerPoolRunResourceOutput(value: unknown): value is WorkerPoolRunResourceOutput {
    return value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'projectedResources') &&
        Object.hasOwn(value, 'runnerErrors');
}

function isWorkerPoolDisposeResourceOutput(value: unknown): value is WorkerPoolDisposeResourceOutput {
    return value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'runnerErrors');
}

function resourceTaskChannel(): WorkerPoolTaskChannel {
    const { port1, port2 } = new NodeMessageChannel();

    return {
        close() {
            port2.close();
        },
        port: port1
    };
}

function recordResourceRunnerErrors(runtime: WorkerPoolRunRuntime, errors: readonly RunnerError[]): void {
    if (errors.length > 0) {
        runtime.runState.recordRunnerErrors(errors);
        runtime.terminalFailure.write(true);
    }
}

function recordResourceLifecycleFailure(runtime: WorkerPoolRunRuntime, message: string, cause: unknown): void {
    if (runtime.terminalFailure.read()) {
        return;
    }

    runtime.runState.recordRunnerError({
        attributedToAttempt: null,
        attributedTo: null,
        attributedToWork: null,
        cause,
        diagnostics: [],
        message,
        subtype: 'runtime-policy'
    });
}

export function createWorkerPoolBatchRunCommand(
    runtime: WorkerPoolRunRuntime,
    members: readonly [WorkerPoolLeaseMember, ...readonly WorkerPoolLeaseMember[]]
): WorkerPoolCommand {
    return {
        ...createBatchRunCommand(runtime, members)
    };
}

export function workerPoolWorkHasStarted(
    startedCases: StartedCaseLedger,
    work: WorkId
): boolean {
    return startedCases.has(workIdentityKey(work));
}

async function acquireRunResourceOutput(
    runtime: WorkerPoolRunRuntime,
    plan: PlacementPlan,
    work: ReturnType<typeof placementRunWork>
): Promise<unknown> {
    const channel = resourceTaskChannel();
    const lane = resourceOwnerLane(plan);

    if (lane === null) {
        throw new Error('Worker-pool resource owner requires a planned lane.');
    }

    try {
        return await runtime.pool.run({
            assignedWork: work,
            boundaryKeys: externallyOwnedResources(plan).map(function ownerBoundaryKey(owner) {
                return owner.boundaryKey;
            }),
            boundaryUseCounts: [],
            command: ownerCommand(runtime, plan, work),
            kind: 'acquire-run-resources',
            lane,
            lifecycle: runtime.lifecycle,
            port: channel.port
        }, {
            name: 'runTask',
            signal: freshSignal(),
            transferList: portTransferList(channel.port)
        });
    } finally {
        channel.close();
    }
}

async function acquireRunResources(
    runtime: WorkerPoolRunRuntime,
    plan: PlacementPlan
): Promise<WorkerPoolResourceLifecycle> {
    const work = ownerWork(plan);
    const output = await acquireRunResourceOutput(runtime, plan, work);

    if (!isWorkerPoolRunResourceOutput(output)) {
        throw new Error('Worker-pool run resource task returned an invalid result.');
    }

    recordResourceRunnerErrors(runtime, output.runnerErrors);

    return {
        completedWork: new Set(),
        ownerBoundaryKeysByWork: boundaryKeysByWork(plan, false),
        ownerLane: resourceOwnerLane(plan),
        projectionBoundaryKeysByWork: boundaryKeysByWork(plan, true),
        projectedResources: output.projectedResources,
        resourceOwner: true,
        runWork: placementRunWork(plan)
    };
}

async function runDisposalTaskOutput(
    runtime: WorkerPoolRunRuntime,
    lane: string,
    kind: 'dispose-lane-lifecycle' | 'dispose-run-resources'
): Promise<unknown> {
    const channel = resourceTaskChannel();

    try {
        return await runtime.pool.run({
            kind,
            lane,
            lifecycle: runtime.lifecycle,
            port: channel.port
        }, {
            name: 'runTask',
            signal: freshSignal(),
            transferList: portTransferList(channel.port)
        });
    } finally {
        channel.close();
    }
}

async function runDisposalTask(
    runtime: WorkerPoolRunRuntime,
    lane: string,
    kind: 'dispose-lane-lifecycle' | 'dispose-run-resources'
): Promise<void> {
    const output = await runDisposalTaskOutput(runtime, lane, kind);

    if (!isWorkerPoolDisposeResourceOutput(output)) {
        throw new Error('Worker-pool resource disposal returned an invalid result.');
    }

    recordResourceRunnerErrors(runtime, output.runnerErrors);
}

async function disposeRunResources(runtime: WorkerPoolRunRuntime, lane: string): Promise<void> {
    try {
        await runDisposalTask(runtime, lane, 'dispose-run-resources');
    } catch (error: unknown) {
        recordResourceLifecycleFailure(runtime, 'Worker-pool run resource disposal failed.', error);
    }
}

async function disposeLaneLifecycles(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): Promise<void> {
    await Promise.all(plan.lanes.map(async function disposeLane(lane) {
        try {
            await runDisposalTask(runtime, lane.id, 'dispose-lane-lifecycle');
        } catch (error: unknown) {
            recordResourceLifecycleFailure(runtime, 'Worker-pool lane resource disposal failed.', error);
        }
    }));
}

export function collectedPlanNeedsLaneResourceLifecycle(runtime: WorkerPoolRunRuntime): boolean {
    return runtime.collectedPlan.files.some(function fileHasLaneResource(file) {
        return file.cases.some(function caseHasLaneResource(testCase) {
            return testCase.resourceAttachments.resourceGraph.some(function isLaneResource(resource) {
                return resource.scope !== 'per-run';
            });
        });
    });
}

export async function acquireWorkerPoolResourceLifecycle(
    runtime: WorkerPoolRunRuntime,
    placementPlan: PlacementPlan
): Promise<WorkerPoolResourceLifecycle> {
    return resourceOwnerLane(placementPlan) === null
        ? {
            completedWork: new Set(),
            ownerBoundaryKeysByWork: new Map(),
            ownerLane: null,
            projectionBoundaryKeysByWork: new Map(),
            projectedResources: { resources: [] },
            resourceOwner: false,
            runWork: placementRunWork(placementPlan)
        }
        : await acquireRunResources(runtime, placementPlan);
}

export function workerPoolProjectedResourcesForWork(
    resourceLifecycle: WorkerPoolResourceLifecycle,
    work: readonly WorkId[]
): WorkerPoolRunResourceOutput['projectedResources'] {
    const boundaryKeys = new Set(work.flatMap(function projectionKeys(item) {
        return resourceLifecycle.projectionBoundaryKeysByWork.get(workIdentityKey(item)) ?? [];
    }));

    return {
        resources: resourceLifecycle.projectedResources.resources.filter(function selectedProjection(resource) {
            return boundaryKeys.has(resource.boundaryKey);
        })
    };
}

async function completeOwnerBoundaries(
    runtime: WorkerPoolRunRuntime,
    resourceLifecycle: WorkerPoolResourceLifecycle,
    boundaryKeys: readonly string[]
): Promise<void> {
    if (resourceLifecycle.ownerLane === null || boundaryKeys.length === 0) {
        return;
    }

    async function runCompletionTask(channel: WorkerPoolTaskChannel): Promise<void> {
        const output: unknown = await runtime.pool.run({
            boundaryKeys,
            kind: 'complete-resource-owner-work',
            lane: resourceLifecycle.ownerLane,
            lifecycle: runtime.lifecycle,
            port: channel.port
        }, {
            name: 'runTask',
            signal: freshSignal(),
            transferList: portTransferList(channel.port)
        });

        if (!isWorkerPoolDisposeResourceOutput(output)) {
            throw new Error('Worker-pool resource owner completion returned an invalid result.');
        }

        recordResourceRunnerErrors(runtime, output.runnerErrors);
    }

    const channel = resourceTaskChannel();

    try {
        await runCompletionTask(channel);
    } catch (error: unknown) {
        recordResourceLifecycleFailure(runtime, 'Worker-pool resource owner completion failed.', error);
        runtime.terminalFailure.write(true);
    } finally {
        channel.close();
    }
}

async function completeWorkerPoolResourceWork(
    runtime: WorkerPoolRunRuntime,
    resourceLifecycle: WorkerPoolResourceLifecycle,
    work: readonly WorkId[]
): Promise<void> {
    const boundaryKeys: string[] = [];

    for (const item of work) {
        const key = workIdentityKey(item);

        if (!resourceLifecycle.completedWork.has(key)) {
            resourceLifecycle.completedWork.add(key);
            boundaryKeys.push(...resourceLifecycle.ownerBoundaryKeysByWork.get(key) ?? []);
        }
    }

    await completeOwnerBoundaries(runtime, resourceLifecycle, boundaryKeys);
}

export async function completeWorkerPoolResourceMembers(
    runtime: WorkerPoolRunRuntime,
    resourceLifecycle: WorkerPoolResourceLifecycle,
    members: readonly WorkerPoolLeaseMember[]
): Promise<void> {
    await completeWorkerPoolResourceWork(
        runtime,
        resourceLifecycle,
        members.flatMap(function completedMemberWork(member) {
            return member.unit.work;
        })
    );
}

export async function disposeWorkerPoolResourceLifecycles(
    runtime: WorkerPoolRunRuntime,
    placementPlan: PlacementPlan,
    resourceLifecycle: WorkerPoolResourceLifecycle
): Promise<void> {
    if (!runtime.terminalFailure.read() && collectedPlanNeedsLaneResourceLifecycle(runtime)) {
        await disposeLaneLifecycles(runtime, placementPlan);
    }

    if (resourceLifecycle.resourceOwner && resourceLifecycle.ownerLane !== null) {
        await disposeRunResources(runtime, resourceLifecycle.ownerLane);
    }
}

async function executeOwnerPreparation(
    runtime: WorkerPoolRunRuntime,
    task: WorkerPoolPrepareResourcesTask
): Promise<readonly RunnerError[]> {
    const output = await runtime.pool.run(task, {
        name: 'runTask',
        signal: freshSignal(),
        transferList: portTransferList(task.port)
    });
    if (!isWorkerPoolDisposeResourceOutput(output)) {
        throw new TypeError('Resource owner preparation returned an invalid result.');
    }
    return output.runnerErrors;
}
async function prepareWorkerPoolResourceArtifacts(
    runtime: WorkerPoolRunRuntime,
    work: WorkId,
    attempt: AttemptId,
    branch: WorkerPoolTaskRun
): Promise<readonly RunnerError[]> {
    const lane = resourceOwnerLane(workerPoolPlacementPlan(runtime.resolvedRun));
    if (lane === null) {
        return [];
    }
    const channel = resourceTaskChannel();
    const task: WorkerPoolPrepareResourcesTask = {
        kind: 'prepare-resource-artifacts',
        work,
        attempt,
        lane,
        lifecycle: runtime.lifecycle,
        attachmentEndpoint: runtime.attachments?.branchEndpoint(branch, branch.includeArtifacts.read) ?? null,
        port: channel.port
    };
    try {
        return await executeOwnerPreparation(runtime, task);
    } finally {
        channel.close();
    }
}

async function resourcePreparationResponse(
    message: Extract<WorkerPoolMessage, { readonly kind: 'prepare-resource-artifacts'; }>,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime
): Promise<readonly RunnerError[]> {
    try {
        return await prepareWorkerPoolResourceArtifacts(runtime, message.work, message.attempt, taskRun);
    } catch (error: unknown) {
        return [ {
            attributedTo: message.work.case,
            attributedToWork: message.work,
            attributedToAttempt: message.attempt,
            cause: error,
            diagnostics: [],
            message: 'Resource owner preparation failed.',
            subtype: 'artifact'
        } ];
    }
}
async function replyResourcePreparation(
    message: Extract<WorkerPoolMessage, { readonly kind: 'prepare-resource-artifacts'; }>,
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    channel: WorkerPoolMessageChannel
): Promise<void> {
    const runnerErrors = await resourcePreparationResponse(message, taskRun, runtime);
    channel.reply({ kind: 'resource-artifacts-prepared', request: message.request, runnerErrors });
}
export function createResourcePreparationChannel(
    taskRun: WorkerPoolTaskRun,
    runtime: WorkerPoolRunRuntime,
    receive: (message: WorkerPoolMessage) => void
): WorkerPoolMessageChannel {
    const channel = createWorkerPoolMessageChannel(function receiveResourceRequest(message) {
        if (message.kind === 'prepare-resource-artifacts') {
            runtime.reporterEvents.add(replyResourcePreparation(message, taskRun, runtime, channel));
        } else {
            receive(message);
        }
    });
    return channel;
}
