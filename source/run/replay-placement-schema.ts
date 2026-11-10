import { z } from 'zod/v4';
import { createCaseId, workIdentityKey } from '../engine/identity.ts';
import { familyVariantSchema, workIdSchema, runtimeIdSchema, workloadIdSchema } from '../engine/identity-schema.ts';
import type { PlacementPlan, WorkUnitId } from './run-types.ts';

const currentWorkUnitIdSchema = z.strictObject({
    familyVariant: familyVariantSchema.default(null),
    key: z.string(),
    mode: z.enum([ 'case', 'file', 'group' ]),
    runtimes: z.array(runtimeIdSchema),
    workload: workloadIdSchema.nullable()
});

const legacyCompilerKeySchema = z
    .tuple([
        z.literal('compiler'),
        z.literal('typescript'),
        z.string().min(1),
        z.string(),
        z.array(z.unknown()),
        z.unknown()
    ])
    .transform(function compilerIdentity([ namespace, language, version, caseKey ]) {
        return { namespace, language, version, caseKey };
    });
const legacyCaseKeySchema = z
    .tuple([
        z.string().nullable(),
        z.array(z.string()),
        z.string(),
        z.string().nullable()
    ])
    .transform(function legacyCase([ file, suite, title, params ]) {
        return createCaseId(file, suite, title, params);
    });

function parsedIdentityKey(key: string): unknown {
    try {
        return JSON.parse(key);
    } catch {
        return null;
    }
}

function normalizeCompilerUnit(unit: Readonly<z.output<typeof currentWorkUnitIdSchema>>): WorkUnitId {
    if (unit.mode !== 'case' || unit.familyVariant !== null) {
        return unit;
    }
    const compiler = legacyCompilerKeySchema.safeParse(parsedIdentityKey(unit.key));
    if (!compiler.success) {
        return unit;
    }
    const testCase = legacyCaseKeySchema.safeParse(parsedIdentityKey(compiler.data.caseKey));
    if (!testCase.success) {
        return unit;
    }
    const work = {
        case: testCase.data,
        runtimes: unit.runtimes,
        workload: unit.workload,
        familyVariant: { family: '@overkill-dev/type-test', key: `typescript@${compiler.data.version}` }
    };
    return { ...unit, key: workIdentityKey(work), familyVariant: work.familyVariant };
}

export const replayWorkUnitIdSchema = currentWorkUnitIdSchema.transform(normalizeCompilerUnit);
const work = z.tuple([ workIdSchema ]).rest(workIdSchema);
const placement = z.union([
    z.strictObject({ id: z.literal('resource-owner'), kind: z.literal('infrastructure-worker') }),
    z.strictObject({ kind: z.literal('executor-lane'), lane: z.string() }),
    z.strictObject({ kind: z.literal('work-unit'), unit: replayWorkUnitIdSchema })
]);
export const replayPlacementPlanSchema: z.ZodType<PlacementPlan> = z.strictObject({
    assignments: z.array(z.strictObject({ lane: z.string(), unit: replayWorkUnitIdSchema })),
    lanes: z.array(z.strictObject({
        id: z.string(),
        executor: z.strictObject({
            id: z.string(),
            capacity: z.number().positive(),
            capabilities: z.array(z.string()),
            kind: z.enum([ 'browser', 'local-process', 'local-worker', 'remote' ])
        })
    })),
    resourceOwnership: z.strictObject({
        owners: z.array(z.strictObject({
            boundaryKey: z.string(),
            placement,
            resourceName: z.string(),
            scope: z.enum([ 'per-file', 'per-run', 'per-suite' ]),
            work
        }))
    }),
    units: z.array(z.strictObject({
        group: z.string().nullable(),
        id: replayWorkUnitIdSchema,
        order: z.enum([ 'lexical', 'plan', 'seeded' ]),
        resourceConstraints: z.strictObject({
            affinityKeys: z.array(z.string()),
            capacityWeight: z.number().positive(),
            duplicateExecution: z.array(z.enum([ 'disposable-isolated', 'idempotent' ])),
            faultDomains: z.array(z.string()),
            serialKeys: z.array(z.string()),
            singleWorkerKeys: z.array(z.string())
        }),
        scheduling: z.enum([ 'concurrent', 'serial' ]),
        work,
        workerLifecycle: z.enum([ 'fresh-worker-per-unit', 'reuse' ])
    }))
});
