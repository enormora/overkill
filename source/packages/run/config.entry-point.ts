import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createConfigLoader } from '../../config/config.ts';

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);

        return true;
    } catch {
        return false;
    }
}

async function importModule(configPath: string): Promise<unknown> {
    return await import(pathToFileURL(configPath).href) as unknown;
}

export const loadConfig = createConfigLoader({
    fileExists,
    importModule
});

export {
    defineConfig,
    normalizeConfig
} from '../../config/config.ts';
export { ConfigError } from '../../config/config-error.ts';
export type { IntegrationRetryPolicy, RetryArtifactPolicy } from '../../config/execution.ts';
export type { ProjectIntegrationRetryPolicy } from '../../config/schema.ts';
export type {
    LoadedConfig,
    ConfigLoader,
    ConfigLoaderDependencies,
    ConfigLoadRequest,
    ProjectCoverageOutput,
    ProjectCoveragePolicy,
    ProjectCoverageSources,
    ProjectCoverageThresholds,
    ProjectAttachmentLimits,
    Config,
    ProjectIntegrationExecution,
    ProjectIntegrationProfileConfig,
    ProjectMeasuredResourceUsage,
    ProjectMicrotestExecution,
    ProjectMicrotestProfileConfig,
    ProjectProfileConfig,
    ProjectProfileFiles,
    ProjectProfilesConfig,
    ProjectResourceBudgets,
    ProjectResourceUsageConfig,
    ProjectTimingProfilePolicy,
    ProjectTimeoutConfig,
    ProjectUnmeasuredResourceUsage
} from '../../config/config.ts';

export type { NormalizedConfig, ProfileConfig, BenchmarkProfileConfig, TestProfileConfig } from '../../config/types.ts';

export type { ProjectBenchmarkProfileConfig } from '../../config/schema.ts';
