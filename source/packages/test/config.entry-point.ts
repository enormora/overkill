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
    ProjectMeasuredProcessUsage,
    ProjectMicrotestExecution,
    ProjectMicrotestProfileConfig,
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
    BenchmarkHostLimits,
    BenchmarkHostPolicy,
    TestProfileConfig
} from '../run/config.entry-point.ts';
