import {
    createGraphPreparation,
    type ImplementationGraphAccess,
    type ImplementationGraphModule,
    type GraphPreparation
} from '../implementation-graph.ts';
import { implementationFingerprint } from '../implementation-fingerprint.ts';
import type { ImplementationFacts } from '../implementation-reference.ts';

type ImplementationGraphFixture = {
    readonly preparation: GraphPreparation;
    readonly access: ImplementationGraphAccess;
    readonly calls: readonly string[];
};
export const mainImplementationUrl = 'file:///project/main.ts';
export const dependencyImplementationUrl = 'file:///project/dependency.ts';
export const implementationFacts: ImplementationFacts = {
    module: { moduleUrl: mainImplementationUrl, exportName: 'value' },
    realm: 'host',
    version: '1',
    input: null,
    dynamicModules: []
};
export function memoryImplementationModule(
    url: string,
    dependencies: Readonly<Record<string, string>>
): ImplementationGraphModule {
    const source = 'export const value = 42;';
    return {
        url,
        dependencies,
        source,
        sourceFingerprint: implementationFingerprint(source),
        format: 'module-typescript',
        packages: [],
        sourceMap: null
    };
}
export function memoryImplementationGraph(modules: readonly ImplementationGraphModule[]): ImplementationGraphFixture {
    const files = new Map(modules.map(function (module) {
        return [ module.url, module ];
    }));
    const calls: string[] = [];
    const access: ImplementationGraphAccess = {
        runtime: { node: 'v26.9.0', platform: 'linux', architecture: 'x64', typescript: 'strip' },
        async canonical(url) {
            calls.push(`canonical:${url}`);
            return url === 'file:///alias/main.ts' ? mainImplementationUrl : url;
        },
        async read(url) {
            calls.push(`read:${url}`);
            const module = files.get(url);
            if (module === undefined) {
                throw new Error(`Unknown implementation module: ${url}`);
            }
            return module;
        }
    };
    return { access, calls, preparation: createGraphPreparation(access) };
}
