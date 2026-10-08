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
    ProjectMeasuredResourceUsage,
    ProjectMicrotestExecution,
    ProjectMicrotestProfileConfig,
    ProjectProfileConfig,
    ProjectProfileFiles,
    ProjectProfilesConfig,
    ProjectResourceBudgets,
    ProjectResourceUsageConfig,
    ProjectTimeoutConfig,
    ProjectUnmeasuredResourceUsage
} from '../run/config.entry-point.ts';

export type {
    LoadedConfig,
    NormalizedConfig,
    ConfigLoadRequest,
    ProfileConfig,
    BenchmarkProfileConfig,
    TestProfileConfig
} from '../run/config.entry-point.ts';
