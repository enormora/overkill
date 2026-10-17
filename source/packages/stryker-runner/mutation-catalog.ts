import { isAbsolute, relative } from 'node:path';
import { z } from 'zod/v4';
import { workIdentityKey, type WorkId, type CollectedRunPlan, type RunSelection } from '../run/run.entry-point.ts';

const caseSchema = z.strictObject({
    file: z.string().nullable(),
    suite: z.array(z.string()),
    title: z.string(),
    params: z.string().nullable()
});
const workSchema = z.strictObject({
    case: caseSchema,
    runtimes: z.array(
        z.strictObject({
            name: z.string(),
            variantId: z
                .string()
                .nullable(),
            dimensions: z.record(z.string(), z.string()),
            scenarios: z.record(z.string(), z.string())
        })
    ),
    workload: z.strictObject({ name: z.string(), params: z.record(z.string(), z.string()) }).nullable()
});
export const mutationCatalogSchema = z.array(z.strictObject({
    id: z.string().min(1),
    work: workSchema,
    annotations: z.strictObject({ ownership: z.array(z.string()), tags: z.array(z.string()) }),
    controls: z.strictObject({
        capture: z.enum([ 'buffered', 'live' ]).nullable(),
        duplicateExecution: z.enum([ 'forbidden', 'idempotent' ]).nullable(),
        timeoutMilliseconds: z.number().nullable()
    }),
    skipReason: z.string().nullable()
}));
export type MutationCatalog = Readonly<z.output<typeof mutationCatalogSchema>>;
export const mutantCoverageSchema = z.strictObject({
    static: z.record(z.string(), z.number().nonnegative()),
    perTest: z.record(z.string(), z.record(z.string(), z.number().nonnegative()))
});
export const campaignBaselineSchema = z
    .strictObject({
        catalog: mutationCatalogSchema.min(1),
        coverageAnalysis: z.enum([ 'off', 'all', 'perTest' ]),
        coverage: mutantCoverageSchema
    })
    .refine(function validBaseline(baseline) {
        const identities = new Set(baseline.catalog.map(function testIdentity(entry) {
            return entry.id;
        }));
        return identities.size === baseline.catalog.length &&
            Object.keys(baseline.coverage.perTest).every(function knownCoverageOwner(id) {
                return identities.has(id);
            });
    }, 'Campaign baseline must contain unique tests and known coverage owners.');
export type CampaignBaseline = Readonly<z.output<typeof campaignBaselineSchema>>;
export const mutationLifecycleDataSchema = z.strictObject({
    catalog: mutationCatalogSchema,
    coverage: mutantCoverageSchema,
    hitLimitExceeded: z.boolean(),
    selected: z.array(z.string()),
    completed: z.array(z.string()),
    bailed: z.boolean()
});

export function projectFile(root: string, file: string): string {
    const normalized = (isAbsolute(file) ? relative(root, file) : file).replaceAll('\\', '/');
    if (normalized === '..' || normalized.startsWith('../') || isAbsolute(normalized)) {
        throw new Error('Test identity escapes the mutation sandbox.');
    }
    return normalized;
}

export function canonicalWork(root: string, work: WorkId): WorkId {
    return {
        ...work,
        case: { ...work.case, file: work.case.file === null ? null : projectFile(root, work.case.file) }
    };
}

export function mutationCatalog(root: string, plan: CollectedRunPlan): MutationCatalog {
    const catalog = plan.files.flatMap(function (file) {
        return file.cases.map(function (testCase) {
            if (testCase.workId === undefined) {
                throw new Error('Collected test has no work identity.');
            }
            const work = canonicalWork(root, testCase.workId);
            return {
                id: workIdentityKey(work),
                work,
                annotations: testCase.annotations,
                controls: testCase.controls,
                skipReason: testCase.skipReason
            };
        });
    });
    const identities = new Set(catalog.map(function testIdentity(entry) {
        return entry.id;
    }));
    if (catalog.length === 0 || identities.size !== catalog.length) {
        throw new Error('Mutation catalog must contain unique eligible tests.');
    }
    return mutationCatalogSchema.parse(catalog.toSorted(function (left, right) {
        return left.id.localeCompare(right.id);
    }));
}
export function eligibleMutationCatalog(
    root: string,
    plan: CollectedRunPlan,
    files: readonly string[] | null
): MutationCatalog {
    const catalog = mutationCatalog(root, plan);
    if (files === null) {
        return catalog;
    }
    const eligible = new Set(files.map(function (file) {
        return projectFile(root, file);
    }));
    if (
        catalog.every(function (entry) {
            return entry.work.case.file === null || !eligible.has(entry.work.case.file);
        })
    ) {
        throw new Error('Stryker test files matched no eligible tests.');
    }
    return catalog.filter(function (entry) {
        return entry.work.case.file !== null && eligible.has(entry.work.case.file);
    });
}

export function exactMutationSelection(root: string, plan: CollectedRunPlan, ids: readonly string[]): RunSelection {
    const selected = new Set(ids);
    const filters = plan.files.flatMap(function (file) {
        return file.cases.flatMap(function (testCase) {
            const work = testCase.workId;
            return work !== undefined && selected.has(workIdentityKey(canonicalWork(root, work)))
                ? [ { kind: 'work-id' as const, id: work } ]
                : [];
        });
    });
    const first = filters[0];
    if (first === undefined || filters.length !== selected.size) {
        throw new Error('Mutant selection contains missing or empty test identities.');
    }
    return { kind: 'filter', filter: { kind: 'any', filters: [ first, ...filters.slice(1) ] } };
}
