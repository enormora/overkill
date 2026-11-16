import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import { moduleReferenceSchema } from './implementation-reference.ts';
import { snapshotPortableValue, type PortableValue } from './portable-value.ts';
import { implementationFingerprint } from './implementation-fingerprint.ts';
import type { ImplementationAssignment, PreparedImplementationAssignments } from './implementation-assignment.ts';
import { implementationGraphIdentity, type GraphIdentity } from './implementation-build.ts';

export type ImplementationBuild = {
    readonly assignments: readonly ImplementationAssignment[];
    readonly graph: GraphIdentity;
};
export type ImplementationCatalog = { readonly projectRoot: string; readonly builds: readonly ImplementationBuild[]; };
export type ImplementationAdmission = 'all' | 'consumer' | {
    readonly body: boolean;
    readonly ownerKeys: readonly string[];
};
export type ImplementationPlanState = {
    readonly catalog: ImplementationCatalog | null;
    readonly admission: ImplementationAdmission;
};
const portable = z.unknown().transform(snapshotPortableValue);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const source = z.strictObject({ url: z.url(), fingerprint });
const facts = z.strictObject({
    module: moduleReferenceSchema,
    realm: z.enum([ 'browser', 'host' ]),
    version: z.string(),
    input: portable,
    dynamicModules: z.array(moduleReferenceSchema)
});
const assignment = z.strictObject({
    key: z.string(),
    role: z.enum([ 'body', 'observer', 'resource-consumer', 'resource-owner' ]),
    scope: z.string().nullable(),
    binding: portable,
    facts
});
const graphData = z.strictObject({
    build: z.string().regex(/^[a-f0-9]{64}$/u),
    runtime: z.strictObject({
        node: z.string(),
        architecture: z.string(),
        platform: z.string(),
        typescript: z.union([ z.literal('strip'), z.literal('transform'), z.literal(false) ])
    }),
    modules: z.array(z.strictObject({
        url: z.string(),
        format: z.enum([ 'json', 'module', 'module-typescript' ]),
        dependencies: z.record(z.string(), z.string()),
        packages: z.array(source),
        sourceMap: source.extend({ kind: z.enum([ 'external', 'inline' ]) }).nullable(),
        deliveredFingerprint: fingerprint,
        sourceFingerprint: fingerprint
    })),
    builtins: z.array(z.string()),
    entries: z.record(z.string(), z.string())
});
const graph = graphData.refine(function validIdentity(value) {
    const { build, ...identity } = value;
    return implementationFingerprint(identity) === build;
}, 'Invalid implementation graph identity.');
export const implementationCatalogSchema: z.ZodType<ImplementationCatalog> = z
    .strictObject({
        projectRoot: z.string().refine(isAbsolute),
        builds: z.array(z.strictObject({ assignments: z.array(assignment), graph })).min(1)
    })
    .transform<ImplementationCatalog>(snapshotPortableValue);
export function implementationBuildIdentity(prepared: PreparedImplementationAssignments): ImplementationBuild {
    return {
        assignments: prepared.assignments,
        graph: { build: prepared.graph.build, ...implementationGraphIdentity(prepared.graph) }
    };
}

export function selectedImplementationAssignments(
    catalog: ImplementationCatalog,
    work: readonly string[]
): readonly ImplementationAssignment[] {
    return catalog.builds.flatMap(function assignments(build) {
        return build.assignments.filter(function selected(entry) {
            return work.some(function owned(key) {
                return entry.key.startsWith(`${key}:`);
            });
        });
    });
}
export function assertImplementationAssignments(
    expected: readonly ImplementationAssignment[],
    actual: readonly ImplementationAssignment[]
): void {
    if (
        expected.length !== actual.length || !isDeepStrictEqual(
            new Map(expected.map(function pair(entry) {
                return [ entry.key, entry ];
            })),
            new Map(actual.map(function pair(entry) {
                return [ entry.key, entry ];
            }))
        )
    ) {
        throw new TypeError('Frozen implementation assignments changed; prepare and collect a new run.');
    }
}

function mergedEvidence<Value>(
    entries: readonly (readonly [string, Value])[],
    message: string
): ReadonlyMap<string, Value> {
    const evidence = new Map<string, Value>();
    for (const [ key, value ] of entries) {
        if (evidence.has(key) && !isDeepStrictEqual(evidence.get(key), value)) {
            throw new TypeError(message);
        }
        evidence.set(key, value);
    }
    return evidence;
}
function assignmentEntries(
    builds: readonly ImplementationBuild[]
): readonly (readonly [string, ImplementationAssignment])[] {
    return builds.flatMap(function assigned(build) {
        return build.assignments.map(function pair(entry) {
            return [ entry.key, entry ] as const;
        });
    });
}
function validateBuilds(builds: readonly ImplementationBuild[]): void {
    const [ first ] = builds;
    for (const build of builds) {
        if (!isDeepStrictEqual(build.graph.runtime, first?.graph.runtime)) {
            throw new TypeError('Implementation runtimes differ.');
        }
    }
    mergedEvidence(
        builds.flatMap(function entries(build) {
            return build.graph.modules.map(function pair(module) {
                return [ module.url, module ] as const;
            });
        }),
        'Implementation module builds differ.'
    );
    mergedEvidence(assignmentEntries(builds), 'Implementation assignments differ.');
    mergedEvidence(
        builds.flatMap(function entries(build) {
            return Object.entries(build.graph.entries);
        }),
        'Implementation entry resolutions differ.'
    );
}
function groupedBuilds(builds: readonly ImplementationBuild[]): readonly ImplementationBuild[] {
    const grouped = new Map<string, ImplementationBuild>();
    for (const build of builds) {
        const previous = grouped.get(build.graph.build);
        const assignments = mergedEvidence(
            assignmentEntries(previous === undefined ? [ build ] : [ previous, build ]),
            'Implementation assignments differ.'
        );
        grouped.set(build.graph.build, { graph: build.graph, assignments: Array.from(assignments.values()) });
    }
    return Array.from(grouped.values());
}
export function mergeImplementationCatalogs(
    catalogs: readonly (ImplementationCatalog | null)[]
): ImplementationCatalog | null {
    const present = catalogs.filter(function available(catalog): catalog is ImplementationCatalog {
        return catalog !== null;
    });
    const [ first ] = present;
    if (first === undefined) {
        return null;
    }
    for (const catalog of present) {
        if (catalog.projectRoot !== first.projectRoot) {
            throw new TypeError('Implementation project roots differ.');
        }
    }
    const builds = present.flatMap(function declared(catalog) {
        return catalog.builds;
    });
    validateBuilds(builds);
    return implementationCatalogSchema.parse({ projectRoot: first.projectRoot, builds: groupedBuilds(builds) });
}

export type ImplementationDeclaration = {
    readonly kind: 'invalid';
    readonly failure: {
        readonly name: string;
        readonly message: string;
        readonly detail: PortableValue;
    };
} | { readonly kind: 'prepared'; readonly build: ImplementationBuild; };
export const implementationDeclarationSchema: z.ZodType<ImplementationDeclaration> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('prepared'), build: z.strictObject({ assignments: z.array(assignment), graph }) }),
    z.strictObject({
        kind: z.literal('invalid'),
        failure: z.strictObject({ name: z.string(), message: z.string(), detail: portable })
    })
]);
function combinedModules(builds: readonly ImplementationBuild[]): GraphIdentity['modules'] {
    const moduleEntries = builds.flatMap(function entries(build) {
        return build.graph.modules.map(function pair(module) {
            return [ module.url, module ] as const;
        });
    });
    const moduleMap = new Map(moduleEntries);
    const modules = Array
        .from(moduleMap.values());
    return modules.toSorted(function byUrl(left, right) {
        return left.url.localeCompare(right.url, 'en');
    });
}
export function combineImplementationBuilds(builds: readonly ImplementationBuild[]): ImplementationBuild {
    const [ first ] = builds;
    if (first === undefined) {
        throw new TypeError('Expected implementation builds.');
    }
    validateBuilds(builds);
    const builtins = Array
        .from(
            new Set(builds.flatMap(function names(build) {
                return build.graph.builtins;
            }))
        )
        .toSorted(function byUrl(left, right) {
            return left.localeCompare(right, 'en');
        });
    const entries = Object.fromEntries(builds.flatMap(function mappings(build) {
        return Object.entries(build.graph.entries);
    }));
    const identity = { modules: combinedModules(builds), builtins, entries, runtime: first.graph.runtime };
    return {
        assignments: Array.from(
            mergedEvidence(assignmentEntries(builds), 'Implementation assignments differ.').values()
        ),
        graph: { ...identity, build: implementationFingerprint(identity) }
    };
}
