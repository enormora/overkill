import { readFile, realpath } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { implementationFingerprint } from './implementation-fingerprint.ts';
import {
    implementationGraphIdentity,
    type ImplementationGraph as GraphDefinition,
    type ImplementationGraphModule as ModuleDefinition
} from './implementation-build.ts';
import { deliverImplementationSource } from './implementation-source-map.ts';
import type { ImplementationFacts } from './implementation-reference.ts';
import { resolveModuleUrl, withModuleDelivery } from './module-loading-scope.ts';
import {
    implementationFormat,
    implementationImports,
    implementationPackages
} from './implementation-source.ts';

export type ImplementationGraph = GraphDefinition;
export type ImplementationGraphModule = ModuleDefinition;

async function canonicalModuleUrl(url: string): Promise<string> {
    if (isBuiltin(url)) {
        return url.startsWith('node:') ? url : `node:${url}`;
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.search !== '' || parsed.hash !== '') {
        throw new TypeError(`Unsupported native implementation URL: ${url}`);
    }
    return pathToFileURL(await realpath(fileURLToPath(url))).href;
}

async function readImplementationModule(url: string): Promise<ImplementationGraphModule> {
    const packages = await implementationPackages(url);
    const format = implementationFormat(url, packages);
    const source = await readFile(fileURLToPath(url), 'utf8');
    const specifiers = format === 'json' ? [] : implementationImports(source, url);
    const dependencies = Object.fromEntries(specifiers.map(function resolve(specifier) {
        return [ specifier, resolveModuleUrl(specifier, url) ];
    }));
    return Object.freeze({
        url,
        format,
        ...await deliverImplementationSource(source, url),
        sourceFingerprint: implementationFingerprint(source),
        dependencies: Object.freeze(dependencies),
        packages: Object.freeze(packages)
    });
}

function graphRoots(facts: readonly ImplementationFacts[]): readonly string[] {
    if (
        facts.some(function unsupportedRealm(fact) {
            return fact.realm !== 'host';
        })
    ) {
        throw new TypeError('The native implementation loader supports the host realm only.');
    }
    return facts.flatMap(function modules(fact) {
        return [
            fact.module.moduleUrl,
            ...fact.dynamicModules.map(function moduleUrl(module) {
                return module.moduleUrl;
            })
        ];
    });
}

async function collectGraph(
    roots: readonly string[],
    readModule: (url: string) => Promise<ImplementationGraphModule>
): Promise<Pick<ImplementationGraph, 'builtins' | 'modules'>> {
    const modules = new Map<string, ImplementationGraphModule>();
    const builtins = new Set<string>();
    async function visit(url: string): Promise<void> {
        if (isBuiltin(url)) {
            builtins.add(url.startsWith('node:') ? url : `node:${url}`);
            return;
        }
        if (modules.has(url)) {
            return;
        }
        const module = await readModule(url);
        modules.set(url, module);
        for (const dependency of Object.values(module.dependencies)) {
            await visit(dependency);
        }
    }
    for (const url of roots) {
        await visit(url);
    }
    return {
        modules: Object.freeze(
            Array.from(modules.values()).toSorted(function byUrl(left, right) {
                return left.url.localeCompare(right.url, 'en');
            })
        ),
        builtins: Object.freeze(
            Array.from(builtins).toSorted(function byUrl(left, right) {
                return left.localeCompare(right, 'en');
            })
        )
    };
}

export type GraphPreparation = {
    readonly prepare: (facts: readonly ImplementationFacts[]) => Promise<ImplementationGraph>;
};
export type ImplementationGraphAccess = {
    readonly canonical: (url: string) => Promise<string>;
    readonly read: (url: string) => Promise<ImplementationGraphModule>;
    readonly runtime: ImplementationGraph['runtime'];
};
export function createGraphPreparation(access: ImplementationGraphAccess): GraphPreparation {
    const sources = new Map<string, Promise<ImplementationGraphModule>>();
    async function readModule(url: string): Promise<ImplementationGraphModule> {
        const existing = sources.get(url);
        if (existing !== undefined) {
            return existing;
        }
        const source = access.read(url);
        sources.set(url, source);
        return source;
    }
    return {
        async prepare(facts) {
            const entries = Object.freeze(
                Object.fromEntries(
                    await Promise.all(
                        graphRoots(facts).map(async function canonicalEntry(url): Promise<readonly [string, string]> {
                            return [ url, await access.canonical(url) ];
                        })
                    )
                )
            );
            const graph = { ...await collectGraph(Object.values(entries), readModule), entries };
            const runtime = Object.freeze({ ...access.runtime });
            return Object.freeze({
                ...graph,
                runtime,
                build: implementationFingerprint(implementationGraphIdentity({ ...graph, runtime }))
            });
        }
    };
}
export function createImplementationGraphPreparation(): GraphPreparation {
    return createGraphPreparation({
        canonical: canonicalModuleUrl,
        read: readImplementationModule,
        runtime: {
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
            typescript: process.features.typescript
        }
    });
}
export async function prepareImplementationGraph(facts: readonly ImplementationFacts[]): Promise<ImplementationGraph> {
    return await createImplementationGraphPreparation().prepare(facts);
}

export function assertImplementationGraph(graph: ImplementationGraph, actual: ImplementationGraph): void {
    if (!isDeepStrictEqual(actual, graph)) {
        throw new TypeError('Implementation graph changed; prepare and collect a new run.');
    }
}

export async function verifyImplementationGraph(
    graph: ImplementationGraph,
    facts: readonly ImplementationFacts[]
): Promise<void> {
    assertImplementationGraph(graph, await prepareImplementationGraph(facts));
}
export async function deliverImplementationGraph<Value>(
    graph: ImplementationGraph,
    operation: (load: (moduleUrl: string) => Promise<{ readonly namespace: unknown; }>) => Promise<Value>,
    deliver: typeof withModuleDelivery
): Promise<Value> {
    const { build, ...identity } = graph;
    if (build !== implementationFingerprint(implementationGraphIdentity(identity))) {
        throw new TypeError('Invalid implementation graph identity.');
    }
    return await deliver(graph, async function resolveEntries(load) {
        return await operation(async function loadEntry(url) {
            const target = graph.entries[url];
            if (target === undefined) {
                throw new TypeError('Implementation entry is outside the frozen graph.');
            }
            return await load(target);
        });
    });
}

export async function withImplementationGraph<Value>(
    graph: ImplementationGraph,
    operation: (load: (moduleUrl: string) => Promise<{ readonly namespace: unknown; }>) => Promise<Value>
): Promise<Value> {
    return await deliverImplementationGraph(graph, operation, withModuleDelivery);
}
