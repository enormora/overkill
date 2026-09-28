import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { PlacementPlan } from './run-types.ts';
import {
    createBatchRunCommand,
    createRunCommand,
    firstPlanUnit,
    placementRunWork
} from './worker-pool-command.ts';
import type { WorkerPoolLeaseMember } from './worker-pool-dispatch-state.ts';
import {
    workerPoolRunResourceOwnerLane,
    type WorkerPoolCommand,
    type WorkerPoolDisposeResourceOutput,
    type WorkerPoolRunResourceOutput
} from './worker-pool-protocol.ts';
import {
    collectedPlanNeedsRunResourceOwner,
    type WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';

type WorkerPoolTaskChannel = {
    readonly close: () => void;
    readonly port: NodeMessagePort;
};

type StartedCaseLedger = {
    readonly has: (caseKey: string) => boolean;
};

export type WorkerPoolResourceLifecycle = {
    readonly projectedResources: WorkerPoolRunResourceOutput['projectedResources'];
    readonly runResourceOwner: boolean;
    readonly runWork: ReturnType<typeof placementRunWork>;
};

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

    try {
        return await runtime.pool.run({
            assignedWork: work,
            boundaryUseCounts: [],
            command: createRunCommand(runtime, firstPlanUnit(plan)),
            kind: 'acquire-run-resources',
            lane: workerPoolRunResourceOwnerLane,
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
    const work = placementRunWork(plan);
    const output = await acquireRunResourceOutput(runtime, plan, work);

    if (!isWorkerPoolRunResourceOutput(output)) {
        throw new Error('Worker-pool run resource task returned an invalid result.');
    }

    recordResourceRunnerErrors(runtime, output.runnerErrors);

    return { projectedResources: output.projectedResources, runResourceOwner: true, runWork: work };
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

async function disposeRunResources(runtime: WorkerPoolRunRuntime): Promise<void> {
    try {
        await runDisposalTask(runtime, workerPoolRunResourceOwnerLane, 'dispose-run-resources');
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
    return collectedPlanNeedsRunResourceOwner(runtime.resolvedRun)
        ? await acquireRunResources(runtime, placementPlan)
        : { projectedResources: { resources: [] }, runResourceOwner: false, runWork: placementRunWork(placementPlan) };
}

export async function disposeWorkerPoolResourceLifecycles(
    runtime: WorkerPoolRunRuntime,
    placementPlan: PlacementPlan,
    resourceLifecycle: WorkerPoolResourceLifecycle
): Promise<void> {
    if (!runtime.terminalFailure.read() && collectedPlanNeedsLaneResourceLifecycle(runtime)) {
        await disposeLaneLifecycles(runtime, placementPlan);
    }

    if (resourceLifecycle.runResourceOwner) {
        await disposeRunResources(runtime);
    }
}
