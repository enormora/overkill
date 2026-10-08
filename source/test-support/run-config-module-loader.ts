import path from 'node:path';
import {
    createConfigLoader,
    type ConfigLoader
} from '../config/config.ts';

export const configFixtureCwd = '/overkill-project';

export function resolvedConfigFixturePath(fileName: string): string {
    return path.resolve(configFixtureCwd, fileName);
}

export function createConfigModuleLoader(modules: Readonly<Record<string, unknown>>): ConfigLoader {
    return createConfigLoader({
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

export function createSingleConfigModuleLoader(fileName: string, module: unknown): ConfigLoader {
    return createConfigModuleLoader({
        [resolvedConfigFixturePath(fileName)]: module
    });
}
