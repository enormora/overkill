import type { WorkId } from '../engine/identity.ts';
import { runCollectionRootFromResolvedPlan } from './collected-run-plan.ts';
import type {
    PlacementPlan,
    WorkUnit
} from './run-types.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import {
    workerPoolExecutionFacts,
    type WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';
import type { WorkerPoolLeaseMember } from './worker-pool-dispatch-state.ts';

function workerPoolEngine(runtime: WorkerPoolRunRuntime): WorkerPoolCommand['engine'] {
    if (runtime.resolvedRun.engine.kind === 'instance') {
        throw new Error('Instance engines are not supported with worker-pool execution. Use a module engine.');
    }

    return runtime.resolvedRun.engine;
}

function unitPaths(unit: WorkUnit): readonly string[] {
    return Array.from(
        new Set(unit.work.map(function toFile(work) {
            if (work.case.file === null) {
                throw new Error('Worker-pool work units require file-backed cases.');
            }

            return work.case.file;
        }))
    );
}

function memberPaths(members: readonly WorkerPoolLeaseMember[]): readonly string[] {
    return Array.from(
        new Set(members.flatMap(function toPaths(member) {
            return unitPaths(member.unit);
        }))
    );
}

export function placementRunWork(plan: PlacementPlan): readonly WorkId[] {
    return plan.units.flatMap(function toWork(unit) {
        return unit.work;
    });
}

export function firstPlanUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool resource acquisition requires a work unit.');
    }

    return unit;
}

export function createRunCommand(runtime: WorkerPoolRunRuntime, unit: WorkUnit): WorkerPoolCommand {
    const execution = workerPoolExecutionFacts(runtime.resolvedRun);

    return {
        collectionTimeoutMilliseconds: runtime.resolvedRun.facts.execution.timeoutPolicy.collectionMilliseconds,
        cwd: runtime.resolvedRun.cwd,
        definitionLocationCapture: 'disabled',
        engine: workerPoolEngine(runtime),
        hardTimeoutMilliseconds: runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
        hostProcess: execution.hostProcess.kind === 'direct'
            ? { kind: 'direct' }
            : {
                kind: 'child',
                nodeArguments: Array.from(execution.hostProcess.nodeArguments)
            },
        maxConcurrency: runtime.resolvedRun.facts.execution.maxConcurrency,
        paths: unitPaths(unit),
        resourceBudgets: runtime.resolvedRun.facts.execution.resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: runtime
            .resolvedRun
            .facts
            .execution
            .resourceUsagePolicy
            .samplingIntervalMilliseconds,
        root: runCollectionRootFromResolvedPlan(runtime.resolvedRun.plan),
        scheduling: unit.scheduling,
        testFamily: runtime.resolvedRun.facts.execution.testFamily,
        retryPolicy: runtime.resolvedRun.facts.execution.retries,
        timeoutMilliseconds: runtime.resolvedRun.facts.execution.timeoutPolicy.softMilliseconds,
        workerLifecycle: unit.workerLifecycle
    };
}

export function createBatchRunCommand(
    runtime: WorkerPoolRunRuntime,
    members: readonly [WorkerPoolLeaseMember, ...readonly WorkerPoolLeaseMember[]]
): WorkerPoolCommand {
    const [ first ] = members;

    return {
        ...createRunCommand(runtime, first.unit),
        paths: memberPaths(members)
    };
}
