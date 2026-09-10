import { glob, realpath, stat } from 'node:fs/promises';
import { createRunDiscovery } from './run-discovery.ts';
import { createRunEngineModuleLoader } from './run-engine-selection.ts';
import { createRunTestModuleLoader } from './run-test-modules.ts';

export const runFileSystem = {
    realpath
};

export const runDiscovery = createRunDiscovery({
    glob,
    realpath,
    stat
});

export const loadRunEngineModule = createRunEngineModuleLoader({
    async importModule(moduleUrl) {
        return await import(moduleUrl) as unknown;
    }
});

export const loadRunTestModules = createRunTestModuleLoader({
    async importModule(href) {
        return await import(href) as unknown;
    }
});
