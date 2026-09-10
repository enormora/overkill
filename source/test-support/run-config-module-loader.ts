import path from 'node:path';
import {
    createRunConfigLoader,
    type RunConfigLoader
} from '../run/run-config.ts';

export const configFixtureCwd = '/overkill-project';

export function resolvedConfigFixturePath(fileName: string): string {
    return path.resolve(configFixtureCwd, fileName);
}

export function createConfigModuleLoader(modules: Readonly<Record<string, unknown>>): RunConfigLoader {
    return createRunConfigLoader({
        async fileExists(filePath) {
            return Object.hasOwn(modules, filePath);
        },
        async importModule(configPath) {
            if (!Object.hasOwn(modules, configPath)) {
                throw new Error(`Missing config fixture: ${configPath}`);
            }

            return modules[configPath];
        }
    });
}

export function createSingleConfigModuleLoader(fileName: string, module: unknown): RunConfigLoader {
    return createConfigModuleLoader({
        [resolvedConfigFixturePath(fileName)]: module
    });
}
