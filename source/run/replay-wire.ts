import { z } from 'zod/v4';
import { emptyPropertyCorpus, type PropertyCorpusSnapshot } from '../engine/property-corpus.ts';
import { witnessFileSchema } from '../engine/witness-file.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { ReplayWire } from './run-types.ts';
import { withReplay, currentReplay } from './replay-context.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import { bindRecordedTestPlan } from './replay-binding.ts';

export const replayWireSchema: z.ZodType<ReplayWire> = z.union([
    z.strictObject({
        kind: z.literal('record'),
        plan: collectedRunPlanSchema,
        witness: witnessFileSchema.nullable().default(null)
    }),
    z.strictObject({
        kind: z.literal('witness'),
        witness: witnessFileSchema,
        moduleGraph: z.enum([ 'current', 'fresh' ]).default('fresh')
    })
]);
export function currentReplayWire(): ReplayWire | null {
    const replay = currentReplay();
    if (replay === null) {
        return null;
    }
    return replay.kind === 'record'
        ? { kind: 'record', plan: replay.record.replayPlan, witness: replay.record.replayWitness }
        : { kind: 'witness', witness: replay.witness, moduleGraph: replay.moduleGraph };
}
export function bindWireReplayPlan(plan: TestPlan, replay: ReplayWire | null): TestPlan {
    return replay?.kind === 'record'
        ? bindRecordedTestPlan(plan, replay.plan)
        : plan;
}

export async function withReplayWire<Value>(replay: ReplayWire | null, execute: () => Promise<Value>): Promise<Value> {
    const witness = replay?.witness ?? null;
    return witness === null
        ? await execute()
        : await withReplay({ kind: 'witness', witness, sourceRunId: null, moduleGraph: 'fresh' }, null, execute);
}
export function wirePropertyCorpus(replay: ReplayWire | null): PropertyCorpusSnapshot {
    return replay?.witness?.kind === 'property'
        ? { ...emptyPropertyCorpus, replay: replay.witness }
        : emptyPropertyCorpus;
}
