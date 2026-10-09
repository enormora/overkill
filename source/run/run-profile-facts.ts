import { copyResourceBudgets } from '../config/snapshot.ts';
import type { ResourceBudgets, ResourceUsagePolicy, ProfileConfig, TimingCollectionMode } from '../config/types.ts';
import type { RunRequest } from './run-types.ts';
import { invalidRequest } from './run-errors.ts';

function disabledResourceBudgets(): ResourceBudgets {
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

function resolveResourceBudgets(
    configBudgets: ResourceBudgets,
    requestOverrides: ResourceBudgets | null
): ResourceBudgets {
    if (requestOverrides === null) {
        return copyResourceBudgets(configBudgets);
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

function hasResourceBudgets(resourceBudgets: ResourceBudgets): boolean {
    return resourceBudgets.activeResourceCount !== null ||
        resourceBudgets.javaScriptEngineHeapBytes !== null ||
        resourceBudgets.residentSetBytes !== null ||
        resourceBudgets.residentSetGrowthBytesPerSecond !== null;
}

function assertResourceBudgetOverridesAllowed(
    measureResourceUsage: boolean,
    requestOverrides: ResourceBudgets | null
): void {
    if (!measureResourceUsage && requestOverrides !== null && hasResourceBudgets(requestOverrides)) {
        invalidRequest('Resource budget overrides require resource usage measurement.');
    }
}

export function resolveResourceUsagePolicy(
    request: RunRequest,
    profile: ProfileConfig
): ResourceUsagePolicy {
    const configuredPolicy = profile.resourceUsage;
    const measureResourceUsage = request.measureResourceUsage ?? configuredPolicy.measure;
    const resourceUsageSamplingIntervalMilliseconds = request.resourceUsageSamplingIntervalMilliseconds ??
        configuredPolicy.samplingIntervalMilliseconds;
    const resourceBudgets = measureResourceUsage
        ? resolveResourceBudgets(configuredPolicy.budgets, request.resourceBudgetOverrides)
        : disabledResourceBudgets();

    assertResourceBudgetOverridesAllowed(measureResourceUsage, request.resourceBudgetOverrides);

    return {
        budgets: resourceBudgets,
        measure: measureResourceUsage,
        samplingIntervalMilliseconds: resourceUsageSamplingIntervalMilliseconds
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
