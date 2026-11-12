import type { z } from 'zod/v4';
import { parse } from '@schema-hub/zod-error-formatter';
import {
    normalizeProfilePolicy,
    normalizeIntegrationExecution,
    assertValidProfileName,
    assertValidWorkDistribution,
    normalizeCoveragePolicy,
    normalizeProfileFiles,
    normalizeRequiredProfileFiles
} from './profile-normalization.ts';
import {
    normalizeDefinedFamilyProfile,
    validateProfileFamilies
} from './family-profile.ts';
import {
    familyProfileSchema,
    type ProjectDefinedFamilyProfile,
    type ProjectAttachmentLimits as ParsedProjectAttachmentLimits,
    integrationProfileSchema,
    microtestProfileSchema,
    projectConfigSchema,
    type Config as ParsedProjectConfig,
    type ProjectBenchmarkProfileConfig,
    type ProjectPropertyProfileConfig as PropertyProfileInput,
    type ParsedPropertyProfileConfig,
    type ProjectCoverageOutput as ParsedProjectCoverageOutput,
    type ProjectCoveragePolicy as ParsedProjectCoveragePolicy,
    type ProjectCoverageSources as ParsedProjectCoverageSources,
    type ProjectCoverageThresholds as ParsedProjectCoverageThresholds,
    type ProjectIntegrationExecution as ParsedProjectIntegrationExecution,
    type ProjectIntegrationProfileConfig as ParsedProjectIntegrationProfileConfig,
    type ProjectMeasuredProcessUsage as ParsedProjectMeasuredProcessUsage,
    type ProjectMicrotestExecution as ParsedProjectMicrotestExecution,
    type ProjectMicrotestProfileConfig as ParsedProjectMicrotestProfileConfig,
    type ProjectProfileFiles as ParsedProjectProfileFiles,
    type ProjectProcessBudgets as ParsedProjectProcessBudgets,
    type ProjectProcessUsageConfig as ParsedProjectProcessUsageConfig,
    type ProjectTimingProfilePolicy as ParsedProjectTimingProfilePolicy,
    type ProjectTimeoutConfig as ParsedProjectTimeoutConfig,
    type ProjectUnmeasuredProcessUsage as ParsedProjectUnmeasuredProcessUsage
} from './schema.ts';
import type {
    BenchmarkExecution,
    BenchmarkProfileConfig,
    IntegrationExecution,
    IntegrationProfileConfig,
    MicrotestProfileConfig,
    NormalizedConfig,
    ProfileConfig,
    ProfilesConfig,
    PropertyProfileConfig
} from './types.ts';
import { ordinaryBaselinePolicySchema, resolveStrictBaselines } from './baseline-policy.ts';
import { ConfigError } from './config-error.ts';
import { validateBenchmarkExecution } from './benchmark-execution.ts';
import {
    defaultBenchmarkTimeoutPolicy,
    defaultIntegrationTimeoutPolicy,
    normalizeHistoryPolicy,
    defaultLoader,
    defaultOutputRenderer,
    defaultTimeoutPolicy,
    normalizeMicrotestExecution
} from './defaults.ts';

type ParsedProfiles = NonNullable<ParsedProjectConfig['profiles']>;
type ParsedProfile = ParsedProfiles[string];
type ParsedBenchmarkProfile = Extract<ParsedProfile, { readonly testFamily: 'benchmark'; }>;

type ProjectHostProcessGuard = Readonly<Partial<Record<'hostProcess', never>>>;
type ProjectRetryPolicyGuard = Readonly<Partial<Record<'retries', never>>>;

export type ProjectIntegrationExecution = ParsedProjectIntegrationExecution & ProjectHostProcessGuard;
type IntegrationArtifactSettings = Pick<
    z.input<typeof integrationProfileSchema>,
    'attachments' | 'baselines' | 'failureArtifacts' | 'retries'
>;
export type ProjectIntegrationProfileConfig = IntegrationArtifactSettings & {
    readonly coverage?: never;
    readonly execution?: ProjectIntegrationExecution | undefined;
    readonly files: ParsedProjectIntegrationProfileConfig['files'];
    readonly reporters?: ParsedProjectIntegrationProfileConfig['reporters'];
    readonly processUsage?: ParsedProjectIntegrationProfileConfig['processUsage'];
    readonly testFamily: ParsedProjectIntegrationProfileConfig['testFamily'];
    readonly runRecords?: ParsedProjectIntegrationProfileConfig['runRecords'];
    readonly timings?: ParsedProjectIntegrationProfileConfig['timings'];
    readonly timeouts?: ParsedProjectIntegrationProfileConfig['timeouts'];
};
export type ProjectMicrotestExecution = ParsedProjectMicrotestExecution;
export type ProjectMicrotestProfileConfig = ParsedProjectMicrotestProfileConfig & ProjectRetryPolicyGuard;
export type ProjectCoverageOutput = ParsedProjectCoverageOutput;
export type ProjectCoveragePolicy = ParsedProjectCoveragePolicy;
export type ProjectCoverageSources = ParsedProjectCoverageSources;
export type ProjectCoverageThresholds = ParsedProjectCoverageThresholds;
export type ProjectProfileFiles = ParsedProjectProfileFiles;
export type ProjectPropertyProfileConfig = PropertyProfileInput;
type StandardTestProfileConfig = ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig;
type BuiltinTestProfileInput = ProjectPropertyProfileConfig | StandardTestProfileConfig;
type ProjectTestProfileConfig = BuiltinTestProfileInput | ProjectDefinedFamilyProfile;
export type ProjectProfileConfig = ProjectBenchmarkProfileConfig | ProjectTestProfileConfig;
export type ProjectProfilesConfig = Readonly<Record<string, ProjectProfileConfig>>;
export type ProjectProcessBudgets = ParsedProjectProcessBudgets;
export type ProjectMeasuredProcessUsage = ParsedProjectMeasuredProcessUsage;
export type ProjectUnmeasuredProcessUsage = ParsedProjectUnmeasuredProcessUsage;
export type ProjectProcessUsageConfig = ParsedProjectProcessUsageConfig;
export type ProjectTimingProfilePolicy = ParsedProjectTimingProfilePolicy;
export type ProjectTimeoutConfig = ParsedProjectTimeoutConfig;
export type Config = {
    readonly history?: ParsedProjectConfig['history'];
    readonly loader?: ParsedProjectConfig['loader'];
    readonly outputRenderer?: ParsedProjectConfig['outputRenderer'];
    readonly profiles?: ProjectProfilesConfig | undefined;
    readonly reporters?: ParsedProjectConfig['reporters'];
    readonly runtimeStateDir?: ParsedProjectConfig['runtimeStateDir'];
};

function assertValidWorkerPoolHedging(execution: IntegrationExecution): void {
    if (
        execution.processModel === 'worker-pool' &&
        execution.hedging.mode === 'on' &&
        execution.dispatchPolicy === 'static-assignment'
    ) {
        throw new ConfigError('Invalid worker-pool hedging: hedging requires dynamic-lease dispatch.');
    }
}

function normalizeMicrotestProfile(
    profile: ProjectMicrotestProfileConfig,
    configPath: string | null
): MicrotestProfileConfig {
    const policy = normalizeProfilePolicy(profile, defaultTimeoutPolicy);

    return {
        ...policy,
        baselines: resolveStrictBaselines(profile.baselines ?? {}),
        coverage: normalizeCoveragePolicy(profile.coverage, configPath),
        execution: normalizeMicrotestExecution(profile.execution),
        files: normalizeProfileFiles(profile.files),
        testFamily: 'microtest'
    };
}

function normalizeIntegrationProfile(profile: ProjectIntegrationProfileConfig): IntegrationProfileConfig {
    const policy = normalizeProfilePolicy(profile, defaultIntegrationTimeoutPolicy);
    const files = normalizeRequiredProfileFiles(profile.files);
    const execution = normalizeIntegrationExecution(profile.execution);

    assertValidWorkDistribution(execution, files);
    assertValidWorkerPoolHedging(execution);

    return {
        ...policy,
        baselines: ordinaryBaselinePolicySchema.parse(profile.baselines ?? {}),
        attachments: integrationProfileSchema.unwrap().shape.attachments.parse(profile.attachments),
        execution,
        files,
        retries: profile.retries === undefined ? null : {
            artifacts: profile.retries.artifacts ?? 'first-failure-and-final',
            maxAttempts: profile.retries.maxAttempts
        },
        testFamily: 'integration'
    };
}

function normalizeBenchmarkExecution(
    execution: ProjectBenchmarkProfileConfig['execution']
): BenchmarkExecution {
    const serialExecution = {
        ...normalizeIntegrationExecution(execution),
        maxConcurrency: 1 as const,
        scheduling: 'serial' as const
    };

    return serialExecution.processModel === 'worker-pool'
        ? { ...serialExecution, hedging: { mode: 'off' } }
        : serialExecution;
}

function normalizeBenchmarkProfile(profile: ParsedBenchmarkProfile): BenchmarkProfileConfig {
    const policy = normalizeProfilePolicy(profile, defaultBenchmarkTimeoutPolicy);
    const execution = normalizeBenchmarkExecution(profile.execution);
    const files = normalizeRequiredProfileFiles(profile.files);

    validateBenchmarkExecution(execution, policy.timeouts);
    assertValidWorkDistribution(execution, files);

    return {
        ...policy,
        attachments: integrationProfileSchema.unwrap().shape.attachments.parse(profile.attachments),
        garbageCollection: profile.garbageCollection,
        baselines: profile.baselines,
        host: profile.host,
        execution,
        files,
        testFamily: 'benchmark'
    };
}

function normalizePropertyProfile(profile: ParsedPropertyProfileConfig): PropertyProfileConfig {
    const policy = normalizeProfilePolicy(profile, {
        collectionMilliseconds: 2000,
        softMilliseconds: 1000,
        hardMilliseconds: 2000
    });
    return {
        ...policy,
        execution: normalizeMicrotestExecution(profile.execution),
        files: normalizeRequiredProfileFiles(profile.files),
        baselines: resolveStrictBaselines(profile.baselines ?? {}),
        corpus: profile.corpus,
        property: profile.property,
        testFamily: 'property'
    };
}

function normalizeProfile(
    profile: ParsedProfile,
    configPath: string | null
): ProfileConfig {
    if (typeof profile.testFamily !== 'string') {
        return normalizeDefinedFamilyProfile(familyProfileSchema.parse(profile));
    }
    if (profile.testFamily === 'property') {
        return normalizePropertyProfile(profile);
    }
    if (profile.testFamily === 'benchmark') {
        return normalizeBenchmarkProfile(profile);
    }

    if (profile.testFamily === 'integration') {
        return normalizeIntegrationProfile(profile);
    }

    return normalizeMicrotestProfile(microtestProfileSchema.parse(profile), configPath);
}

function normalizeConfiguredProfiles(
    profiles: ParsedProjectConfig['profiles'],
    configPath: string | null
): ProfilesConfig {
    const normalizedProfiles: Record<string, ProfileConfig> = {};
    const profileEntries = Object.entries(profiles ?? {});

    validateProfileFamilies(profiles ?? {});
    for (const [ profileName, profile ] of profileEntries) {
        assertValidProfileName(profileName);
        normalizedProfiles[profileName] = normalizeProfile(profile, configPath);
    }

    if (normalizedProfiles.microtest === undefined) {
        normalizedProfiles.microtest = normalizeMicrotestProfile({ testFamily: 'microtest' }, null);
    }

    return normalizedProfiles;
}

function normalizeConfigForOrigin(parsedConfig: ParsedProjectConfig, configPath: string | null): NormalizedConfig {
    return {
        history: normalizeHistoryPolicy(parsedConfig.history ?? {}),
        loader: parsedConfig.loader ?? defaultLoader,
        outputRenderer: parsedConfig.outputRenderer ?? defaultOutputRenderer,
        profiles: normalizeConfiguredProfiles(parsedConfig.profiles, configPath),
        reporters: parsedConfig.reporters ?? null,
        runtimeStateDir: parsedConfig.runtimeStateDir ?? '.overkill'
    };
}

function parseConfig(configValue: unknown, configPath: string | null): ParsedProjectConfig {
    try {
        return parse(projectConfigSchema, configValue);
    } catch (error: unknown) {
        const location = configPath === null ? 'Invalid config' : `Invalid config file "${configPath}"`;

        throw new ConfigError(`${location}: ${String(error)}`, { cause: error });
    }
}

export function normalizeConfigFromOrigin(config: unknown, configPath: string | null): NormalizedConfig {
    return normalizeConfigForOrigin(parseConfig(config, configPath), configPath);
}

export function normalizeConfig(config: Config): NormalizedConfig {
    return normalizeConfigFromOrigin(config, null);
}

export type ProjectAttachmentLimits = ParsedProjectAttachmentLimits;
