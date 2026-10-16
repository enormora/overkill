import { microtestExecutionSchema, propertyProfileSchema } from './schema.ts';
import { propertyPolicySchema } from './property-policy.ts';
import { ConfigError } from './config-error.ts';
import { validateNormalizedBenchmarkHostPolicy } from './benchmark-host.ts';
import { performanceBaselinePolicySchema } from './performance-baselines.ts';
import { validateHostProcess } from './host-process.ts';
import { assertValidProfileName, normalizeRequiredProfileFiles } from './profile-normalization.ts';
import { validateBenchmarkExecution } from './benchmark-execution.ts';
import type {
    NormalizedConfig,
    BenchmarkProfileConfig,
    ProfileConfig,
    PropertyProfileConfig,
    ProcessBudgets,
    ProcessUsagePolicy,
    TimeoutPolicy
} from './types.ts';

function validatePositiveSafeInteger(value: number | null, label: string): void {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new ConfigError(`${label} must be a positive safe integer.`);
    }
}

function validateProcessBudgets(processBudgets: ProcessBudgets): void {
    validatePositiveSafeInteger(processBudgets.activeResourceCount, 'Active Node resource count budget');
    validatePositiveSafeInteger(processBudgets.javaScriptEngineHeapBytes, 'JavaScript engine heap budget');
    validatePositiveSafeInteger(processBudgets.residentSetBytes, 'Resident set budget');
    validatePositiveSafeInteger(processBudgets.residentSetGrowthBytesPerSecond, 'Resident set growth budget');
}

function validateSamplingInterval(value: number | null): void {
    validatePositiveSafeInteger(value, 'Process usage sampling interval');
}

function validateTimeoutPolicy(policy: TimeoutPolicy): void {
    validatePositiveSafeInteger(policy.collectionMilliseconds, 'Collection timeout');
    validatePositiveSafeInteger(policy.softMilliseconds, 'Soft timeout');
    validatePositiveSafeInteger(policy.hardMilliseconds, 'Hard timeout');

    if (policy.softMilliseconds > policy.hardMilliseconds) {
        throw new ConfigError('Soft timeout must not exceed hard timeout.');
    }
}

function hasProcessBudgets(processBudgets: ProcessBudgets): boolean {
    return processBudgets.activeResourceCount !== null ||
        processBudgets.javaScriptEngineHeapBytes !== null ||
        processBudgets.residentSetBytes !== null ||
        processBudgets.residentSetGrowthBytesPerSecond !== null;
}

export function validateProcessUsagePolicy(policy: ProcessUsagePolicy): void {
    validateProcessBudgets(policy.budgets);
    validateSamplingInterval(policy.samplingIntervalMilliseconds);

    if (!policy.measure && hasProcessBudgets(policy.budgets)) {
        throw new ConfigError('Process budgets require process usage measurement.');
    }
}

function validateMicrotestProfile(profile: ProfileConfig): void {
    validateProcessUsagePolicy(profile.processUsage);
    validateTimeoutPolicy(profile.timeouts);
}

function validateAttachmentLimits(profile: ProfileConfig): void {
    if (profile.testFamily === 'microtest' || profile.testFamily === 'property') {
        return;
    }
    for (const [ name, value ] of Object.entries(profile.attachments)) {
        validatePositiveSafeInteger(value, `Attachment ${name}`);
    }
}

function validateIntegrationProfile(profile: ProfileConfig): void {
    validateAttachmentLimits(profile);
    validateProcessUsagePolicy(profile.processUsage);
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
        validateNormalizedBenchmarkHostPolicy(profile.host);
        validateIntegrationProfile(profile);
        validateBenchmarkExecution(profile.execution, profile.timeouts);
    } catch (error: unknown) {
        throw new ConfigError(`Invalid benchmark profile "${profileName}": ${String(error)}`, { cause: error });
    }
}

function validatePropertyProfile(profile: PropertyProfileConfig): void {
    validateMicrotestProfile(profile);
    normalizeRequiredProfileFiles(profile.files);
    microtestExecutionSchema.parse(profile.execution);
    propertyPolicySchema.parse(profile.property);
    const permittedFields = propertyProfileSchema.unwrap().shape;
    if (
        Object.keys(profile).some(function unsupportedPropertyField(name) {
            return !Object.hasOwn(permittedFields, name);
        })
    ) {
        throw new ConfigError('Property profiles cannot configure additional fields.');
    }
}

function validateProfileFamily(profileName: string, testFamily: unknown): void {
    if (
        testFamily !== 'benchmark' && testFamily !== 'integration' && testFamily !== 'microtest' &&
        testFamily !== 'property'
    ) {
        throw new ConfigError(
            [
                `Invalid profile "${profileName}":`,
                'testFamily must be "benchmark", "integration", "microtest", or "property".'
            ]
                .join(' ')
        );
    }
}

export function validateNormalizedConfig(config: NormalizedConfig): void {
    for (const [ profileName, profile ] of Object.entries(config.profiles)) {
        assertValidProfileName(profileName);
        validateProfileFamily(profileName, profile.testFamily);

        if (profile.testFamily === 'benchmark') {
            validateBenchmarkProfile(profileName, profile);
        } else if (profile.testFamily === 'property') {
            validatePropertyProfile(profile);
        } else if (profile.testFamily === 'microtest') {
            validateMicrotestProfile(profile);
        } else {
            validateIntegrationProfile(profile);
        }
    }
}
