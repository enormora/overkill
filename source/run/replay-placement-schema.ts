import { z } from 'zod/v4';
import { workIdSchema, runtimeIdSchema, workloadIdSchema } from '../engine/identity-schema.ts';
import type { PlacementPlan } from './run-types.ts';

export const replayWorkUnitIdSchema = z.strictObject({
    key: z.string(),
    mode: z.enum([ 'case', 'file', 'group' ]),
    runtimes: z.array(runtimeIdSchema),
    workload: workloadIdSchema.nullable()
});
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
