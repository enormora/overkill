import { z } from 'zod/v4';
import { caseIdSchema, workIdSchema } from '../engine/identity-schema.ts';
import { serializedValueSchema } from '../compare/serialized-value-schema.ts';
import { loaderSchema, integrationExecutionSchema, workGroupSchema } from '../config/schema.ts';
import { normalizedMicrotestProfileSchema } from '../config/normalized-microtest-schema.ts';
import { propertyPolicySchema } from '../engine/property-policy.ts';
import { runDebugRequestSchema } from './run-debug.ts';
import { hasRecordedWorkerCapacity, replayPlanningFields } from './replay-planning-schema.ts';
import type { MergeRunFacts } from './run-record-types.ts';

const engine = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('default') }),
    z.object({ kind: z.literal('instance') }),
    z.object({
        kind: z.literal('module'),
        exportKind: z.enum([ 'getter', 'value' ]),
        exportName: z.string(),
        moduleUrl: z.string()
    })
]);
const profile = normalizedMicrotestProfileSchema.shape;
const group = workGroupSchema.unwrap().required();
const execution = {
    ...replayPlanningFields.execution.shape,
    runRecords: z.object({
        persist: z.boolean(),
        reasons: z.array(z.enum([ 'request', 'last-failed', 'merge', 'coverage', 'debug', 'profile', 'artifact' ]))
    }),
    benchmarkGarbageCollection: z.enum([ 'off', 'after-sample' ]).nullable(),
    propertyPolicy: propertyPolicySchema.nullable(),
    attachments: z
        .object({
            maxInlineBytes: z.number(),
            maxArtifactBytes: z.number(),
            maxScopeBytes: z.number(),
            maxScopeAttachments: z.number()
        })
        .nullable(),
    retries: z
        .object({
            maxAttempts: z.number(),
            artifacts: z.enum([ 'all', 'first-failure-and-final', 'last-failure-and-final' ])
        })
        .nullable(),
    baselineUpdateMode: z.enum([ 'apply', 'bootstrap', 'diff', 'none', 'update' ]),
    capture: z.enum([ 'buffered', 'live' ]),
    coverage: z.boolean(),
    debug: runDebugRequestSchema,
    debuggedCases: z.array(workIdSchema),
    engine,
    maxConcurrency: z.union([ z.number(), z.literal('unlimited') ]),
    order: z.enum([ 'plan', 'seeded', 'lexical' ]),
    profile: z.string(),
    processUsagePolicy: profile.processUsage,
    failureArtifacts: profile.failureArtifacts,
    timingCollection: z.enum([ 'summary', 'precise' ]),
    timeoutPolicy: profile.timeouts,
    verbose: z.literal(false)
};
const baseFacts = {
    ...replayPlanningFields,
    adapter: z.object({ id: z.string(), facts: z.json() }).nullable(),
    coveragePolicy: profile.coverage.nullable(),
    cases: z.array(
        z.object({
            workId: workIdSchema,
            id: caseIdSchema,
            fileSet: z.string().nullable(),
            annotations: serializedValueSchema,
            controls: serializedValueSchema,
            propertyPolicy: propertyPolicySchema.nullable()
        })
    ),
    environment: z.object({
        node: z.object({ arch: z.string(), platform: z.string(), version: z.string() }),
        projectRoot: z.string(),
        runtimeStateDir: z.string()
    }),
    loader: loaderSchema,
    execution: z.union([
        z.object({ ...execution, processModel: z.enum([ 'in-process', 'supervised-process' ]) }),
        z.object({
            ...execution,
            processModel: z.literal('worker-pool'),
            assignmentPolicy: integrationExecutionSchema.options[1].unwrap().shape.assignmentPolicy.unwrap(),
            dispatchPolicy: z.enum([ 'dynamic-lease', 'static-assignment' ]),
            hedging: integrationExecutionSchema.options[1].unwrap().shape.hedging.unwrap(),
            workDistribution: z.union([
                z.object({ mode: z.literal('file') }),
                z.object({ mode: z.literal('case') }),
                z.object({
                    mode: z.literal('group'),
                    unmatched: z.enum([ 'file', 'reject' ]),
                    groups: z.tuple([ group ]).rest(group)
                })
            ]),
            workerLifecycle: z.enum([ 'reuse', 'fresh-worker-per-unit' ]),
            workerCount: replayPlanningFields.execution.shape.workerCount.unwrap().unwrap(),
            hostProcess: replayPlanningFields.execution.shape.hostProcess.unwrap().unwrap()
        })
    ])
};
export const mergeFactsSchema: z.ZodType<MergeRunFacts> = z.object(baseFacts).refine(hasRecordedWorkerCapacity);
