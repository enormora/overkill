import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRunConfigLoader } from '../../run/run-config.ts';

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

export const loadRunConfig = createRunConfigLoader({
    fileExists,
    importModule
});

export {
    defineConfig
} from '../../run/run-config.ts';
export { RunConfigError } from '../../run/run-errors.ts';
export type { IntegrationRetryPolicy, RetryArtifactPolicy } from '../../run/run-execution-config.ts';
export type { RunProjectIntegrationRetryPolicy } from '../../run/run-config-schema.ts';
export type {
    LoadedRunConfig,
    RunConfigLoader,
    RunConfigLoaderDependencies,
    RunConfigLoadRequest,
    RunProjectCoverageOutput,
    RunProjectCoveragePolicy,
    RunProjectCoverageSources,
    RunProjectCoverageThresholds,
    RunProjectAttachmentLimits,
    RunProjectConfig,
    RunProjectIntegrationExecution,
    RunProjectIntegrationProfileConfig,
    RunProjectMeasuredResourceUsage,
    RunProjectMicrotestExecution,
    RunProjectMicrotestProfileConfig,
    RunProjectProfileConfig,
    RunProjectProfileFiles,
    RunProjectProfilesConfig,
    RunProjectResourceBudgets,
    RunProjectResourceUsageConfig,
    RunProjectTimingProfilePolicy,
    RunProjectTimeoutConfig,
    RunProjectUnmeasuredResourceUsage
} from '../../run/run-config.ts';
