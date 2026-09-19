import { workIdentityKey } from '../engine/identity.ts';
import type { WorkUnit } from './run-types.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

export type UnitLoad = (unit: WorkUnit) => number;

const medianDivisor = 2;

function median(values: readonly number[]): number {
    const sorted = values.toSorted(function compareNumber(left, right) {
        return left - right;
    });
    const middle = Math.floor(sorted.length / medianDivisor);
    const value = sorted[middle];

    if (value === undefined) {
        return 0;
    }

    return sorted.length % medianDivisor === 1
        ? value
        : ((sorted[middle - 1] ?? value) + value) / medianDivisor;
}

function caseCountLoad(unit: WorkUnit): number {
    return unit.work.length + unit.resourceConstraints.capacityWeight - 1;
}

function durationHistoryUnitLoad(
    samples: NonNullable<WorkerPoolRunRuntime['resolvedRun']['facts']['durationHistory']>['samples']
): UnitLoad {
    const fallbackDuration = median(samples.map(function toDuration(sample) {
        return sample.durationMilliseconds;
    }));
    const durationByWorkKey = new Map(samples.map(function toEntry(sample) {
        return [ workIdentityKey(sample.work), sample.durationMilliseconds ];
    }));

    return function unitDuration(unit) {
        return unit.work.reduce(function sumDuration(total, work) {
            return total + (durationByWorkKey.get(workIdentityKey(work)) ?? fallbackDuration);
        }, 0) * unit.resourceConstraints.capacityWeight;
    };
}

function durationHistoryLoad(runtime: WorkerPoolRunRuntime): UnitLoad | null {
    const { durationHistory, execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool' || execution.assignmentPolicy !== 'duration-history-balanced') {
        return null;
    }

    if (durationHistory === null || durationHistory.samples.length === 0) {
        return null;
    }

    return durationHistoryUnitLoad(durationHistory.samples);
}

export function runtimeUnitLoad(runtime: WorkerPoolRunRuntime): UnitLoad {
    return durationHistoryLoad(runtime) ?? caseCountLoad;
}
