export { defineConfig, normalizeConfig, loadConfig, ConfigError } from '../run/config.entry-point.ts';
export type {
    IntegrationRetryPolicy,
    RetryArtifactPolicy,
    ProjectIntegrationRetryPolicy
} from '../run/config.entry-point.ts';
export type {
    ProjectAttachmentLimits,
    Config,
    ProjectCoverageOutput,
    ProjectCoveragePolicy,
    ProjectCoverageSources,
    ProjectCoverageThresholds,
    ProjectIntegrationExecution,
    ProjectIntegrationProfileConfig,
    ProjectBenchmarkProfileConfig,
    ProjectAdapterProfileConfig,
    ProjectMeasuredProcessUsage,
    ProjectMicrotestExecution,
    ProjectMicrotestProfileConfig,
    ProjectPropertyProfileConfig,
    ProjectProfileConfig,
    ProjectProfileFiles,
    ProjectProfilesConfig,
    ProjectProcessBudgets,
    ProjectProcessUsageConfig,
    ProjectTimeoutConfig,
    ProjectUnmeasuredProcessUsage
} from '../run/config.entry-point.ts';

export type {
    LoadedConfig,
    NormalizedConfig,
    ConfigLoadRequest,
    ProfileConfig,
    BenchmarkProfileConfig,
    AdapterProfileConfig,
    BenchmarkHostLimits,
    BenchmarkHostPolicy,
    TestProfileConfig
} from '../run/config.entry-point.ts';

export type { RunRecordPersistenceMode, RunRecordProfilePolicy } from '../run/config.entry-point.ts';

export { defineBaselineAdapter } from '../run/config.entry-point.ts';
export type {
    BaselineAdapterDefinition,
    BaselinePayload,
    OrdinaryBaselineAdapter,
    OrdinaryBaselineSubtype,
    OrdinaryObservationInput
} from '../run/config.entry-point.ts';

export type { OrdinaryBaselinePolicy } from '../run/config.entry-point.ts';
