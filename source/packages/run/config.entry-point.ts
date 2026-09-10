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
    defineConfig,
    RunConfigError
} from '../../run/run-config.ts';
export type {
    LoadedRunConfig,
    RunConfigLoader,
    RunConfigLoaderDependencies,
    RunConfigLoadRequest,
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
    RunProjectTimeoutConfig,
    RunProjectUnmeasuredResourceUsage
} from '../../run/run-config.ts';
