import { AsyncLocalStorage } from 'node:async_hooks';
import { workIdentityKey } from '../engine/identity.ts';
import type { WitnessFile } from '../engine/witness-file.ts';
import { RunCollectionError } from './run-errors.ts';
import { availableReplayResourceOwners } from './replay-resource-owners.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import type {
    ResolvedRun,
    PlacementPlan,
    CollectedRunPlan,
    RunFacts,
    RunWorkerCountFacts,
    RunHostProcessFacts
} from './run-types.ts';
import type { ReplayPlanningFacts, ReplayRunRecord } from './replay-record-types.ts';

export type ReplayExecution = {
    readonly kind: 'record';
    readonly record: ReplayRunRecord;
} | {
    readonly kind: 'witness';
    readonly witness: WitnessFile;
    readonly sourceRunId: string | null;
};
type ReplayExecutionPlan = {
    readonly recordedFacts: ReplayPlanningFacts;
    readonly hostProcess: RunHostProcessFacts | null;
    readonly benchmarkPlacement: RunFacts['benchmarkPlacement'];
    readonly durationHistory: RunFacts['durationHistory'];
    readonly orderedCases: ReturnType<typeof collectedRunCaseEntries>;
    readonly placementPlan: PlacementPlan | null;
    readonly scheduling: RunFacts['execution']['scheduling'];
    readonly workerCount: RunWorkerCountFacts | null;
};
type ReplayInvocation = { readonly execution: ReplayExecution; readonly signal: Readonly<AbortSignal> | null; };
const replayContext = new AsyncLocalStorage<ReplayInvocation>();
export function currentReplay(): ReplayExecution | null {
    return replayContext.getStore()?.execution ?? null;
}
export function currentReplayWitness(): WitnessFile | null {
    const replay = currentReplay();
    if (replay === null) {
        return null;
    }
    return replay.kind === 'witness' ? replay.witness : replay.record.replayWitness;
}
export async function withReplay<Value>(
    replay: ReplayExecution,
    signal: Readonly<AbortSignal> | null,
    execute: () => Promise<Value>
): Promise<Value> {
    return await replayContext.run({ execution: replay, signal }, execute);
}

function assertPropertyTarget(
    target: CollectedRunPlan['files'][number]['cases'][number],
    witness: Extract<WitnessFile, { readonly kind: 'property'; }>
): void {
    const expected = witness.target.kind === 'property-value' ? 'property' : 'nested';
    if (target.property?.definition.kind !== expected) {
        throw new RunCollectionError(
            'Witness property target no longer matches its declaration.',
            { cause: null },
            'loader'
        );
    }
}
function assertSimulationTarget(
    target: CollectedRunPlan['files'][number]['cases'][number],
    witness: Extract<WitnessFile, { readonly kind: 'simulation'; }>
): void {
    const name = witness.resource?.name ?? witness.simulation.name;
    const matches = target.resourceAttachments.resourceGraph.filter(function owner(resource) {
        return resource.name === name;
    });
    if (matches.length !== 1) {
        throw new RunCollectionError('Simulation witness resource is missing or ambiguous.', { cause: null }, 'loader');
    }
}
function assertWitnessSelection(collection: CollectedRunPlan, witness: WitnessFile): void {
    const selected = collectedRunCaseEntries(collection);
    const [ target ] = selected;
    if (target === undefined || selected.length !== 1) {
        throw new RunCollectionError('Witness replay target is missing or ambiguous.', { cause: null }, 'loader');
    }
    if (witness.kind === 'property') {
        assertPropertyTarget(target.testCase, witness);
    } else {
        assertSimulationTarget(target.testCase, witness);
    }
}
export function replayExecutionPlan(collection: CollectedRunPlan): ReplayExecutionPlan | null {
    const replay = currentReplay();
    const witness = currentReplayWitness();
    if (witness !== null) {
        assertWitnessSelection(collection, witness);
    }
    if (replay?.kind !== 'record') {
        return null;
    }
    const saved = replay.record.facts;
    const byIdentity = new Map(
        collectedRunCaseEntries(collection).map(function keyed(entry) {
            return [ workIdentityKey(entry.workId), entry ];
        })
    );
    const orderedCases = saved.cases.map(function restoreOrder(entry) {
        const selected = byIdentity.get(workIdentityKey(entry.workId));
        if (selected === undefined) {
            throw new TypeError('Recorded work is missing its case metadata.');
        }
        return selected;
    });
    return {
        recordedFacts: saved,
        hostProcess: saved.execution.hostProcess,
        benchmarkPlacement: saved.benchmarkPlacement,
        durationHistory: saved.durationHistory,
        orderedCases,
        placementPlan: saved.execution.placementPlan,
        scheduling: saved.execution.scheduling,
        workerCount: saved.execution.workerCount
    };
}

export function replayPlacementPlan(run: ResolvedRun, plan: PlacementPlan): PlacementPlan {
    if (currentReplay()?.kind !== 'record' || run.plan.kind === 'local') {
        return plan;
    }
    return availableReplayResourceOwners(plan, run.plan.collectedPlan);
}

export function currentReplaySignal(): Readonly<AbortSignal> | null {
    return replayContext.getStore()?.signal ?? null;
}
