import { assertSupportedProcessEngine as assertSupportedProcessEngineSelection } from './run-process-engine.ts';
import {
    invalidRequest,
    unsupportedRequest
} from './run-errors.ts';
import { validateRunEngineSelection } from './run-engine-selection.ts';
import { invalidRunSelectionMessage } from './run-selection-filters.ts';
import {
    invalidRunProfileNameMessage,
    type RunCommand,
    type RunConfig,
    type RunMicrotestProfileConfig,
    type RunProfileConfig,
    type RunRequest,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunTestFamily,
    type RunTimeoutPolicy
} from './run-types.ts';

const minimumSeedValue = 0n;

function validateRunShard(request: RunRequest): void {
    if (request.shard.index !== 0 || request.shard.total !== 1) {
        unsupportedRequest('Sharding is not implemented yet.');
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

function validateResourceBudgets(resourceBudgets: RunResourceBudgets): void {
    validatePositiveSafeInteger(resourceBudgets.activeResourceCount, 'Active resource count budget');
    validatePositiveSafeInteger(resourceBudgets.javaScriptEngineHeapBytes, 'JavaScript engine heap budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetBytes, 'Resident set budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetGrowthBytesPerSecond, 'Resident set growth budget');
}

function validateSamplingInterval(value: number | null): void {
    validatePositiveSafeInteger(value, 'Resource usage sampling interval');
}

function validateTimeoutPolicy(policy: RunTimeoutPolicy): void {
    validatePositiveSafeInteger(policy.collectionMilliseconds, 'Collection timeout');
    validatePositiveSafeInteger(policy.softMilliseconds, 'Soft timeout');
    validatePositiveSafeInteger(policy.hardMilliseconds, 'Hard timeout');

    if (policy.softMilliseconds > policy.hardMilliseconds) {
        invalidRequest('Soft timeout must not exceed hard timeout.');
    }
}

function hasResourceBudgets(resourceBudgets: RunResourceBudgets): boolean {
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

function assertValidRunProfileName(profileName: string): void {
    const message = invalidRunProfileNameMessage(profileName);

    if (message !== null) {
        invalidRequest(message);
    }
}

function validateRunRequest(request: RunRequest): void {
    assertValidRunProfileName(request.profile);

    validateRunShard(request);
    validateRunSeed(request);
    validateRunSelection(request);
    validateRunResourceUsageRequest(request);
}

function validateRunCommand(command: RunCommand): void {
    validateRunEngineSelection(command.engine);
}

export function validateRunResourceUsagePolicy(policy: RunResourceUsagePolicy): void {
    validateResourceBudgets(policy.budgets);
    validateSamplingInterval(policy.samplingIntervalMilliseconds);

    if (!policy.measure && hasResourceBudgets(policy.budgets)) {
        invalidRequest('Resource budgets require resource usage measurement.');
    }
}

function validateRunMicrotestProfile(profile: RunProfileConfig): void {
    validateRunResourceUsagePolicy(profile.resourceUsage);
    validateTimeoutPolicy(profile.timeouts);
}

const runProfileValidators: Readonly<Record<RunTestFamily, (profile: RunProfileConfig) => void>> = {
    microtest: validateRunMicrotestProfile
};

function readProfileTestFamily(profile: RunProfileConfig): unknown {
    return (profile as { readonly testFamily?: unknown; }).testFamily;
}

function isRunTestFamily(value: unknown): value is RunTestFamily {
    return value === 'microtest';
}

function validateRunProfile(profileName: string, profile: RunProfileConfig): void {
    const testFamily = readProfileTestFamily(profile);

    if (!isRunTestFamily(testFamily)) {
        invalidRequest(`Invalid run profile "${profileName}": testFamily must be "microtest".`);
    }

    runProfileValidators[testFamily](profile);
}

function validateRunConfig(config: RunConfig): void {
    for (const [ profileName, profile ] of Object.entries(config.profiles)) {
        assertValidRunProfileName(profileName);
        validateRunProfile(profileName, profile);
    }
}

export function validateRunInput(command: RunCommand): void {
    validateRunCommand(command);
    validateRunRequest(command.request);
    validateRunConfig(command.config);
}

export function assertSupportedProcessEngine(command: RunCommand, profile: RunMicrotestProfileConfig): void {
    assertSupportedProcessEngineSelection(command, profile);
}
