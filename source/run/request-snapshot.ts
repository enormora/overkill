import { copyResourceBudgets } from '../config/snapshot.ts';
import type { ResourceBudgets } from '../config/types.ts';
import type { RunRequest, RunShard } from './run-types.ts';
import { copyRunSelection } from './run-selection-filters.ts';

function copyRunShard(shard: RunShard): RunShard {
    return {
        index: shard.index,
        total: shard.total
    };
}

function copyResourceBudgetOverrides(overrides: ResourceBudgets | null): ResourceBudgets | null {
    if (overrides === null) {
        return null;
    }

    return copyResourceBudgets(overrides);
}

export function copyRunRequest(request: RunRequest): RunRequest {
    return {
        baselineUpdateMode: request.baselineUpdateMode,
        capabilityRestrictions: { mode: request.capabilityRestrictions.mode },
        capture: request.capture,
        coverage: request.coverage,
        debug: {
            mode: request.debug.mode,
            selectors: []
        },
        execution: { mode: request.execution.mode },
        measureResourceUsage: request.measureResourceUsage,
        order: request.order,
        paths: Array.from(request.paths),
        profile: request.profile,
        resourceBudgetOverrides: copyResourceBudgetOverrides(request.resourceBudgetOverrides),
        resourceUsageSamplingIntervalMilliseconds: request.resourceUsageSamplingIntervalMilliseconds,
        seed: { value: request.seed.value },
        selection: copyRunSelection(request.selection),
        shard: copyRunShard(request.shard),
        timingCollection: request.timingCollection,
        verbose: request.verbose,
        workers: request.workers
    };
}
