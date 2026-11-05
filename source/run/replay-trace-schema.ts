import { z } from 'zod/v4';
import { workIdSchema } from '../engine/identity-schema.ts';
import { replayWorkUnitIdSchema } from './replay-placement-schema.ts';
import type { PlacementTrace } from './placement-trace.ts';

const attempt = z.templateLiteral([ 'attempt-', z.number() ]);
const worker = z.templateLiteral([ z.number(), ':', z.number() ]);
const dynamicUnit = z.strictObject({ child: z.string(), parent: replayWorkUnitIdSchema });
const unit = z.union([ replayWorkUnitIdSchema, dynamicUnit ]);
const work = z.tuple([ workIdSchema ]).rest(workIdSchema);
const attempts = z.tuple([ attempt ]).rest(attempt);
const cause = z.enum([
    'hard-timeout',
    'host-failure',
    'run-stopped',
    'hedge-cancelled',
    'runtime-policy',
    'worker-crash'
]);
const recovery = z.union([
    z.strictObject({ kind: z.literal('abandon'), abandonedWork: work }),
    z.strictObject({ kind: z.literal('partial'), abandonedWork: work, retryWork: work }),
    z.strictObject({ kind: z.literal('retry'), retryWork: work })
]);
export const replayTraceSchema: z.ZodType<PlacementTrace> = z.strictObject({
    entries: z.array(z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('worker-crashed'),
            activeAttempt: attempt.nullable(),
            lane: z.string(),
            workerId: worker.nullable()
        }),
        z.strictObject({ kind: z.literal('recovery-decided'), attempt, cause, decision: recovery }),
        z.strictObject({ kind: z.literal('attempt-interrupted'), attempt, cause }),
        z.strictObject({
            kind: z.literal('attempt-completed'),
            attempt,
            durationMicroseconds: z.number().nonnegative()
        }),
        z.strictObject({
            kind: z.literal('attempt-assigned'),
            attempt,
            lane: z.string(),
            unit,
            work,
            reason: z.union([
                z.strictObject({ kind: z.literal('initial') }),
                z.strictObject({ kind: z.literal('hedge'), primaryAttempt: attempt }),
                z.strictObject({ kind: z.literal('recovery'), previousAttempt: attempt })
            ])
        }),
        z.strictObject({ kind: z.literal('attempt-started'), attempt, workerId: worker }),
        z.strictObject({
            kind: z.enum([ 'batch-completed', 'batch-started' ]),
            attempts,
            envelopeId: z.string(),
            lane: z.string()
        }),
        z.strictObject({
            kind: z.literal('hedge-conflict'),
            authoritativeAttempt: attempt,
            conflictingAttempt: attempt
        }),
        z.strictObject({
            kind: z.literal('hedge-resolved'),
            authoritativeAttempt: attempt,
            discardedAttempt: attempt,
            outcome: z.enum([ 'cancelled', 'matched' ])
        }),
        z.strictObject({
            kind: z.literal('warm-lane-affinity-selected'),
            baselineUnit: unit,
            candidateUnits: z.tuple([ unit ]).rest(unit),
            lane: z.string(),
            matchedWarmKeys: z
                .tuple([ z.enum([ 'affinity', 'directory', 'file', 'runtime-workload' ]) ])
                .rest(z.enum([ 'affinity', 'directory', 'file', 'runtime-workload' ])),
            score: z.number(),
            selectedUnit: unit
        }),
        z.strictObject({
            kind: z.literal('unit-split'),
            children: z.tuple([ dynamicUnit ]).rest(dynamicUnit),
            parent: replayWorkUnitIdSchema
        })
    ]))
});
