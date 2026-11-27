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
        const source = `export * as namespace from ${JSON.stringify(href)};`;
        const bridge: unknown = await import(`data:text/javascript,${encodeURIComponent(source)}`);

        if (typeof bridge !== 'object' || bridge === null || !Object.hasOwn(bridge, 'namespace')) {
            throw new TypeError('Test module import did not produce a namespace.');
        }

        const namespace: unknown = Reflect.get(bridge, 'namespace');
        return { namespace };
    }
});
