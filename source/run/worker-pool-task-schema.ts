import { z } from 'zod/v4';
import type { WorkerPoolTaskWithoutPort } from './worker-pool-host-protocol.ts';
import { workIdSchema, runtimeIdSchema, workloadIdSchema } from './run-identity-schema.ts';
import { executionCommandFields, hostProcessSchema } from './run-command-schema.ts';

const workUnitSchema = z.strictObject({
    key: z.string(),
    mode: z.enum([ 'case', 'file', 'group' ]),
    runtimes: z.array(runtimeIdSchema),
    workload: workloadIdSchema.nullable()
});
const assignedUnitSchema = z.strictObject({
    attempt: z.templateLiteral([ 'attempt-', z.number() ]),
    traceUnit: z.union([ workUnitSchema, z.strictObject({ child: z.string(), parent: workUnitSchema }) ]),
    work: z.array(workIdSchema)
});
const commandSchema = z.strictObject({
    ...executionCommandFields,
    hostProcess: hostProcessSchema,
    workerLifecycle: z.enum([ 'fresh-worker-per-unit', 'reuse' ])
});
const lifecycleFields = { lane: z.string(), lifecycle: z.strictObject({ token: z.string() }) };
const boundaryUsesSchema = z.array(z.strictObject({ boundaryKey: z.string(), count: z.number() }));
export const workerPoolTaskSchema: z.ZodType<WorkerPoolTaskWithoutPort> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('collect'), command: commandSchema }),
    z.strictObject({
        kind: z.literal('run'),
        ...lifecycleFields,
        assignedUnits: z.array(assignedUnitSchema),
        assignedWork: z.array(workIdSchema),
        boundaryUseCounts: boundaryUsesSchema,
        command: commandSchema,
        projectedResources: z.strictObject({
            resources: z.array(z.strictObject({ boundaryKey: z.string(), payload: z.json() }))
        }),
        runWork: z.array(workIdSchema),
        startedAtMilliseconds: z.number()
    }),
    z.strictObject({
        kind: z.literal('acquire-run-resources'),
        ...lifecycleFields,
        assignedWork: z.array(workIdSchema),
        boundaryKeys: z.array(z.string()),
        boundaryUseCounts: boundaryUsesSchema,
        command: commandSchema
    }),
    z.strictObject({
        kind: z.literal('complete-resource-owner-work'),
        ...lifecycleFields,
        boundaryKeys: z.array(z.string())
    }),
    z.strictObject({ kind: z.enum([ 'dispose-run-resources', 'dispose-lane-lifecycle' ]), ...lifecycleFields })
]);
