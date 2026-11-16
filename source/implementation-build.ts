import type { Except } from 'type-fest';
import type { DeliveredModule } from './module-loading-scope.ts';
import type { ImplementationPackage } from './implementation-source.ts';
import type { ImplementationSourceMap } from './implementation-source-map.ts';
import { implementationFingerprint } from './implementation-fingerprint.ts';

export type ImplementationGraphModule = DeliveredModule & {
    readonly packages: readonly ImplementationPackage[];
    readonly sourceMap: ImplementationSourceMap | null;
    readonly sourceFingerprint: string;
};
export type ImplementationGraph = {
    readonly build: string;
    readonly runtime: {
        readonly node: string;
        readonly platform: string;
        readonly architecture: string;
        readonly typescript: 'strip' | 'transform' | false;
    };
    readonly modules: readonly ImplementationGraphModule[];
    readonly builtins: readonly string[];
    readonly entries: Readonly<Record<string, string>>;
};
type SourceIdentity = { readonly url: string; readonly fingerprint: string; };
type SourceMapIdentity = SourceIdentity & { readonly kind: 'external' | 'inline'; };
export type ModuleIdentity = Except<ImplementationGraphModule, 'packages' | 'source' | 'sourceMap'> & {
    readonly deliveredFingerprint: string;
    readonly packages: readonly SourceIdentity[];
    readonly sourceMap: SourceMapIdentity | null;
};
export type GraphIdentity = Except<ImplementationGraph, 'modules'> & { readonly modules: readonly ModuleIdentity[]; };
export type GraphContents = Except<ImplementationGraph, 'build'>;
export type GraphIdentityContents = Except<GraphIdentity, 'build'>;

export function implementationGraphIdentity(graph: GraphContents): GraphIdentityContents {
    const modules = graph.modules.map(function identity(module): ModuleIdentity {
        const { source, packages, sourceMap, ...fields } = module;
        return {
            ...fields,
            deliveredFingerprint: implementationFingerprint(source),
            packages: packages.map(function packageIdentity(value) {
                return { url: value.url, fingerprint: implementationFingerprint(value.source) };
            }),
            sourceMap: sourceMap === null
                ? null
                : {
                    kind: sourceMap.url.startsWith('data:') ? 'inline' : 'external',
                    url: (sourceMap.url.startsWith('data:') ? module : sourceMap).url,
                    fingerprint: implementationFingerprint(sourceMap.source)
                }
        };
    });
    return { modules, builtins: graph.builtins, entries: graph.entries, runtime: graph.runtime };
}
