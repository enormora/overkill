import { copyProcessBudgets } from '../config/snapshot.ts';
import type { ProcessBudgets } from '../config/types.ts';
import type { RunRequest, RunShard } from './run-types.ts';
import { copyRunSelection } from './run-selection-filters.ts';

function copyRunShard(shard: RunShard): RunShard {
    return {
        index: shard.index,
        total: shard.total
    };
}

function copyProcessBudgetOverrides(overrides: ProcessBudgets | null): ProcessBudgets | null {
    if (overrides === null) {
        return null;
    }

    return copyProcessBudgets(overrides);
}

export function copyRunRequest(request: RunRequest): RunRequest {
    return {
        baselineUpdateMode: request.baselineUpdateMode,
        capabilityRestrictions: { mode: request.capabilityRestrictions.mode },
        capture: request.capture,
        coverage: request.coverage,
        record: request.record,
        debug: {
            mode: request.debug.mode,
            selectors: []
        },
        execution: { mode: request.execution.mode },
        measureProcessUsage: request.measureProcessUsage,
        order: request.order,
        paths: Array.from(request.paths),
        profile: request.profile,
        processBudgetOverrides: copyProcessBudgetOverrides(request.processBudgetOverrides),
        processUsageSamplingIntervalMilliseconds: request.processUsageSamplingIntervalMilliseconds,
        seed: { value: request.seed.value },
        selection: copyRunSelection(request.selection),
        shard: copyRunShard(request.shard),
        timingCollection: request.timingCollection,
        verbose: request.verbose,
        workers: request.workers
    };
}
