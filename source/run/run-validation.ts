import { validateNormalizedConfig } from '../config/validation.ts';
import { invalidProfileNameMessage } from '../config/profile-patterns.ts';
import type { TestProfileConfig, ResourceBudgets } from '../config/types.ts';
import { assertSupportedProcessEngine as assertSupportedProcessEngineSelection } from './run-process-engine.ts';
import { invalidRequest } from './run-errors.ts';
import { validateRunEngineSelection } from './run-engine-selection.ts';

import { invalidRunSelectionMessage } from './run-selection-filters.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

const minimumSeedValue = 0n;

function validateRunShard(request: RunRequest): void {
    if (!Number.isSafeInteger(request.shard.total) || request.shard.total <= 0) {
        invalidRequest('Shard total must be a positive safe integer.');
    }

    if (!Number.isSafeInteger(request.shard.index) || request.shard.index <= 0) {
        invalidRequest('Shard index must be a positive safe integer.');
    }

    if (request.shard.index > request.shard.total) {
        invalidRequest('Shard index must not exceed shard total.');
    }
}

function validateRunSeed(request: RunRequest): void {
    if (request.seed.value !== null && request.seed.value < minimumSeedValue) {
        invalidRequest('Run seed must be a nonnegative bigint.');
    }
}

function validatePositiveSafeInteger(value: number | null, label: string): void {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
        invalidRequest(`${label} must be a positive safe integer.`);
    }
}

function validateResourceBudgets(resourceBudgets: ResourceBudgets): void {
    validatePositiveSafeInteger(resourceBudgets.activeResourceCount, 'Active resource count budget');
    validatePositiveSafeInteger(resourceBudgets.javaScriptEngineHeapBytes, 'JavaScript engine heap budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetBytes, 'Resident set budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetGrowthBytesPerSecond, 'Resident set growth budget');
}

function validateSamplingInterval(value: number | null): void {
    validatePositiveSafeInteger(value, 'Resource usage sampling interval');
}

function hasResourceBudgets(resourceBudgets: ResourceBudgets): boolean {
    return resourceBudgets.activeResourceCount !== null ||
        resourceBudgets.javaScriptEngineHeapBytes !== null ||
        resourceBudgets.residentSetBytes !== null ||
        resourceBudgets.residentSetGrowthBytesPerSecond !== null;
}

function validateRunResourceUsageRequest(request: RunRequest): void {
    if (request.resourceBudgetOverrides !== null) {
        validateResourceBudgets(request.resourceBudgetOverrides);
    }

    validateSamplingInterval(request.resourceUsageSamplingIntervalMilliseconds);

    if (
        request.measureResourceUsage === false &&
        request.resourceBudgetOverrides !== null &&
        hasResourceBudgets(request.resourceBudgetOverrides)
    ) {
        invalidRequest('Resource budget overrides require resource usage measurement.');
    }
}

function validateRunSelection(request: RunRequest): void {
    const message = invalidRunSelectionMessage(request.selection);

    if (message !== null) {
        invalidRequest(message);
    }
}

function requestTimingCollection(request: RunRequest): unknown {
    return request.timingCollection;
}

function validateTimingCollection(request: RunRequest): void {
    const timingCollection = requestTimingCollection(request);

    if (timingCollection !== 'profile-default' && timingCollection !== 'precise') {
        invalidRequest('Timing collection must be "profile-default" or "precise".');
    }
}

function assertValidRunProfileName(profileName: string): void {
    const message = invalidProfileNameMessage(profileName);

    if (message !== null) {
        invalidRequest(message);
    }
}

function validateRunRequest(request: RunRequest): void {
    assertValidRunProfileName(request.profile);

    validatePositiveSafeInteger(request.workers, 'Worker count');
    validateRunShard(request);
    validateRunSeed(request);
    validateRunSelection(request);
    validateTimingCollection(request);
    validateRunResourceUsageRequest(request);
}

function validateRunCommand(command: RunCommand): void {
    validateRunEngineSelection(command.engine);
}

export function validateRunInput(command: RunCommand): void {
    validateRunCommand(command);
    validateRunRequest(command.request);
    validateNormalizedConfig(command.config);
}

export function assertSupportedProcessEngine(command: RunCommand, profile: TestProfileConfig): void {
    assertSupportedProcessEngineSelection(command, profile);
}
