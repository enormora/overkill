import { z } from 'zod/v4';
import { propertyPolicySchema } from '../engine/property-policy.ts';
import {
    isDefinedFamilyProfile,
    type NormalizedConfig,
    type MicrotestProfileConfig,
    type BenchmarkProfileConfig,
    type ProfileConfig,
    type PropertyProfileConfig,
    type ProcessBudgets,
    type ProcessUsagePolicy,
    type TimeoutPolicy,
    type DefinedFamilyProfile
} from './types.ts';

import {
    validateProfileFamilies,
    validateProfileFamily,
    validateFamilyDefinition
} from './family-profile.ts';
import { microtestExecutionSchema, propertyProfileSchema } from './schema.ts';
import { ConfigError } from './config-error.ts';
import {
    performanceBaselinePolicySchema,
    ordinaryBaselinePolicySchema,
    resolveStrictBaselines
} from './baseline-policy.ts';
import { validateHostProcess } from './host-process.ts';
import { assertValidProfileName, normalizeRequiredProfileFiles } from './profile-normalization.ts';
import { validateBenchmarkHostExecution } from './benchmark-execution.ts';

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

function validateMicrotestProfile(profile: MicrotestProfileConfig | PropertyProfileConfig): void {
    resolveStrictBaselines(profile.baselines);
    validateProcessUsagePolicy(profile.processUsage);
    validateTimeoutPolicy(profile.timeouts);
}

function validateAttachmentLimits(profile: ProfileConfig): void {
    if (profile.testFamily !== 'benchmark' && profile.testFamily !== 'integration') {
        return;
    }
    for (const [ name, value ] of Object.entries(profile.attachments)) {
        validatePositiveSafeInteger(value, `Attachment ${name}`);
    }
}

function validateIntegrationProfile(profile: ProfileConfig): void {
    if (
        typeof profile.testFamily === 'string' && profile.testFamily !== 'benchmark'
    ) {
        ordinaryBaselinePolicySchema.parse(profile.baselines);
    }
    validateAttachmentLimits(profile);
    validateProcessUsagePolicy(profile.processUsage);
    validateTimeoutPolicy(profile.timeouts);

    if (profile.execution.processModel === 'worker-pool') {
        validatePositiveSafeInteger(profile.execution.maxWorkers, 'Profile worker maximum');
        validateHostProcess(profile.execution.hostProcess);
    }
}

function validateBenchmarkGarbageCollection(policy: unknown): void {
    z.enum([ 'after-sample', 'off' ]).parse(policy);
}

function validateBenchmarkProfile(profileName: string, profile: BenchmarkProfileConfig): void {
    try {
        normalizeRequiredProfileFiles(profile.files);
        performanceBaselinePolicySchema.parse(profile.baselines);
        validateBenchmarkGarbageCollection(profile.garbageCollection);
        validateBenchmarkHostExecution(profile);
        validateIntegrationProfile(profile);
    } catch (error: unknown) {
        throw new ConfigError(`Invalid benchmark profile "${profileName}": ${String(error)}`, { cause: error });
    }
}

function validatePropertyProfile(profile: PropertyProfileConfig): void {
    validateMicrotestProfile(profile);
    normalizeRequiredProfileFiles(profile.files);
    microtestExecutionSchema.parse(profile.execution);
    propertyPolicySchema.parse(profile.property);
    propertyProfileSchema.unwrap().shape.corpus.parse(profile.corpus);
    const permittedFields = propertyProfileSchema.unwrap().shape;
    if (
        Object.keys(profile).some(function unsupportedPropertyField(name) {
            return !Object.hasOwn(permittedFields, name);
        })
    ) {
        throw new ConfigError('Property profiles cannot configure additional fields.');
    }
}

function validateImportedProfile(profile: DefinedFamilyProfile): void {
    validateFamilyDefinition(profile);
    normalizeRequiredProfileFiles(profile.files);
    validateProcessUsagePolicy(profile.processUsage);
    validateTimeoutPolicy(profile.timeouts);
}

function validateProfile(profileName: string, profile: ProfileConfig): void {
    propertyProfileSchema.unwrap().shape.failureArtifacts.parse(profile.failureArtifacts);
    if (isDefinedFamilyProfile(profile)) {
        validateImportedProfile(profile);
    } else if (profile.testFamily === 'benchmark') {
        validateBenchmarkProfile(profileName, profile);
    } else if (profile.testFamily === 'property') {
        validatePropertyProfile(profile);
    } else if (profile.testFamily === 'microtest') {
        validateMicrotestProfile(profile);
    } else {
        validateIntegrationProfile(profile);
    }
}

export function validateNormalizedConfig(config: NormalizedConfig): void {
    for (const [ profileName, profile ] of Object.entries(config.profiles)) {
        assertValidProfileName(profileName);
        validateProfileFamily(profileName, profile.testFamily);
        validateProfile(profileName, profile);
        if (!z.strictObject({ persist: z.enum([ 'on-demand', 'always' ]) }).safeParse(profile.runRecords).success) {
            throw new ConfigError('Invalid run record persistence policy.');
        }
    }
    validateProfileFamilies(config.profiles);
}
