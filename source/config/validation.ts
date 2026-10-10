import { ConfigError } from './config-error.ts';
import { performanceBaselinePolicySchema } from './performance-baselines.ts';
import { validateHostProcess } from './host-process.ts';
import { assertValidProfileName, normalizeRequiredProfileFiles } from './profile-normalization.ts';
import { validateBenchmarkExecution } from './benchmark-execution.ts';
import type {
    NormalizedConfig,
    BenchmarkProfileConfig,
    ProfileConfig,
    ResourceBudgets,
    ResourceUsagePolicy,
    TimeoutPolicy
} from './types.ts';

function validatePositiveSafeInteger(value: number | null, label: string): void {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new ConfigError(`${label} must be a positive safe integer.`);
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

function validateTimeoutPolicy(policy: TimeoutPolicy): void {
    validatePositiveSafeInteger(policy.collectionMilliseconds, 'Collection timeout');
    validatePositiveSafeInteger(policy.softMilliseconds, 'Soft timeout');
    validatePositiveSafeInteger(policy.hardMilliseconds, 'Hard timeout');

    if (policy.softMilliseconds > policy.hardMilliseconds) {
        throw new ConfigError('Soft timeout must not exceed hard timeout.');
    }
}

function hasResourceBudgets(resourceBudgets: ResourceBudgets): boolean {
    return resourceBudgets.activeResourceCount !== null ||
        resourceBudgets.javaScriptEngineHeapBytes !== null ||
        resourceBudgets.residentSetBytes !== null ||
        resourceBudgets.residentSetGrowthBytesPerSecond !== null;
}

export function validateResourceUsagePolicy(policy: ResourceUsagePolicy): void {
    validateResourceBudgets(policy.budgets);
    validateSamplingInterval(policy.samplingIntervalMilliseconds);

    if (!policy.measure && hasResourceBudgets(policy.budgets)) {
        throw new ConfigError('Resource budgets require resource usage measurement.');
    }
}

function validateMicrotestProfile(profile: ProfileConfig): void {
    validateResourceUsagePolicy(profile.resourceUsage);
    validateTimeoutPolicy(profile.timeouts);
}

function validateAttachmentLimits(profile: ProfileConfig): void {
    if (profile.testFamily === 'microtest') {
        return;
    }
    for (const [ name, value ] of Object.entries(profile.attachments)) {
        validatePositiveSafeInteger(value, `Attachment ${name}`);
    }
}

function validateIntegrationProfile(profile: ProfileConfig): void {
    validateAttachmentLimits(profile);
    validateResourceUsagePolicy(profile.resourceUsage);
    validateTimeoutPolicy(profile.timeouts);

    if (profile.execution.processModel === 'worker-pool') {
        validatePositiveSafeInteger(profile.execution.maxWorkers, 'Profile worker maximum');
        validateHostProcess(profile.execution.hostProcess);
    }
}

function validateBenchmarkProfile(profileName: string, profile: BenchmarkProfileConfig): void {
    try {
        normalizeRequiredProfileFiles(profile.files);
        performanceBaselinePolicySchema.parse(profile.baselines);
        validateIntegrationProfile(profile);
        validateBenchmarkExecution(profile.execution, profile.timeouts);
    } catch (error: unknown) {
        throw new ConfigError(`Invalid benchmark profile "${profileName}": ${String(error)}`, { cause: error });
    }
}

function validateProfileFamily(profileName: string, testFamily: unknown): void {
    if (testFamily !== 'benchmark' && testFamily !== 'integration' && testFamily !== 'microtest') {
        throw new ConfigError(
            `Invalid profile "${profileName}": testFamily must be "benchmark", "integration", or "microtest".`
        );
    }
}

export function validateNormalizedConfig(config: NormalizedConfig): void {
    for (const [ profileName, profile ] of Object.entries(config.profiles)) {
        assertValidProfileName(profileName);
        validateProfileFamily(profileName, profile.testFamily);

        if (profile.testFamily === 'benchmark') {
            validateBenchmarkProfile(profileName, profile);
        } else if (profile.testFamily === 'microtest') {
            validateMicrotestProfile(profile);
        } else {
            validateIntegrationProfile(profile);
        }
    }
}
