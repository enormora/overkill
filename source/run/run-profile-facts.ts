import { copyProcessBudgets } from '../config/snapshot.ts';
import type {
    ProcessBudgets,
    ProcessUsagePolicy,
    ProfileConfig,
    Scheduling,
    TimingCollectionMode
} from '../config/types.ts';
import type { RunRequest } from './run-types.ts';
import { invalidRequest } from './run-errors.ts';

export function resolveRunScheduling(request: RunRequest, profile: ProfileConfig): Scheduling {
    return request.execution.mode === 'serial' ? 'serial' : profile.execution.scheduling;
}

function disabledProcessBudgets(): ProcessBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function readBudgetOverride(configValue: number | null, requestValue: number | null): number | null {
    return requestValue ?? configValue;
}

function resolveProcessBudgets(
    configBudgets: ProcessBudgets,
    requestOverrides: ProcessBudgets | null
): ProcessBudgets {
    if (requestOverrides === null) {
        return copyProcessBudgets(configBudgets);
    }

    return {
        activeResourceCount: readBudgetOverride(
            configBudgets.activeResourceCount,
            requestOverrides.activeResourceCount
        ),
        javaScriptEngineHeapBytes: readBudgetOverride(
            configBudgets.javaScriptEngineHeapBytes,
            requestOverrides.javaScriptEngineHeapBytes
        ),
        residentSetBytes: readBudgetOverride(configBudgets.residentSetBytes, requestOverrides.residentSetBytes),
        residentSetGrowthBytesPerSecond: readBudgetOverride(
            configBudgets.residentSetGrowthBytesPerSecond,
            requestOverrides.residentSetGrowthBytesPerSecond
        )
    };
}

function hasProcessBudgets(processBudgets: ProcessBudgets): boolean {
    return processBudgets.activeResourceCount !== null ||
        processBudgets.javaScriptEngineHeapBytes !== null ||
        processBudgets.residentSetBytes !== null ||
        processBudgets.residentSetGrowthBytesPerSecond !== null;
}

function assertProcessBudgetOverridesAllowed(
    measureProcessUsage: boolean,
    requestOverrides: ProcessBudgets | null
): void {
    if (!measureProcessUsage && requestOverrides !== null && hasProcessBudgets(requestOverrides)) {
        invalidRequest('Process budget overrides require process usage measurement.');
    }
}

export function resolveProcessUsagePolicy(
    request: RunRequest,
    profile: ProfileConfig
): ProcessUsagePolicy {
    const configuredPolicy = profile.processUsage;
    const measureProcessUsage = request.measureProcessUsage ?? configuredPolicy.measure;
    const processUsageSamplingIntervalMilliseconds = request.processUsageSamplingIntervalMilliseconds ??
        configuredPolicy.samplingIntervalMilliseconds;
    const processBudgets = measureProcessUsage
        ? resolveProcessBudgets(configuredPolicy.budgets, request.processBudgetOverrides)
        : disabledProcessBudgets();

    assertProcessBudgetOverridesAllowed(measureProcessUsage, request.processBudgetOverrides);

    return {
        budgets: processBudgets,
        measure: measureProcessUsage,
        samplingIntervalMilliseconds: processUsageSamplingIntervalMilliseconds
    };
}

function strategyRequiresPreciseTiming(profile: ProfileConfig): boolean {
    return profile.execution.processModel === 'worker-pool' &&
        (
            profile.execution.assignmentPolicy === 'duration-history-balanced' ||
            profile.execution.hedging.mode === 'on'
        );
}

export function resolveTimingCollection(
    request: RunRequest,
    profile: ProfileConfig
): TimingCollectionMode {
    if (request.timingCollection === 'precise' || strategyRequiresPreciseTiming(profile)) {
        return 'precise';
    }

    return profile.timings.collection;
}
