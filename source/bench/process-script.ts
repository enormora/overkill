import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';

const maximumMarkerBytes = 65_536;
const markerText = z.string().min(1).refine(function boundedMarker(text) {
    return Buffer.byteLength(text) <= maximumMarkerBytes;
}, 'Output markers cannot exceed 65536 bytes.');
const pipeMarker = z.strictObject({ stream: z.enum([ 'stdout', 'stderr' ]), text: markerText });
const terminalMarker = z.strictObject({ stream: z.literal('terminal'), text: markerText });
const writeStep = z.strictObject({ kind: z.literal('write'), text: z.string() });
const closeInputStep = z.strictObject({ kind: z.literal('close-input') });
const resizeStep = z.strictObject({
    kind: z.literal('resize'),
    columns: z.number().int().positive(),
    rows: z.number().int().positive()
});
const interactionName = z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/u);
const pipeExpect = z.strictObject({ kind: z.literal('expect'), marker: pipeMarker });
const terminalExpect = pipeExpect.extend({ marker: terminalMarker });
const pipeInteraction = z.strictObject({
    kind: z.literal('interaction'),
    name: interactionName,
    input: z.string(),
    marker: pipeMarker
});
const terminalInteraction = pipeInteraction.extend({ marker: terminalMarker });
const pipeCheckpoint = z.discriminatedUnion('kind', [ pipeExpect, pipeInteraction ]);
const terminalCheckpoint = z.discriminatedUnion('kind', [ terminalExpect, terminalInteraction ]);
const pipeStep = z.union([ writeStep, closeInputStep, pipeCheckpoint ]);
const terminalStep = z.union([ writeStep, resizeStep, terminalCheckpoint ]);

function endingWithCheckpoint<Step, Checkpoint extends Step>(
    steps: readonly Step[],
    checkpoint: Readonly<z.ZodType<Checkpoint>>,
    context: Readonly<z.RefinementCtx>
): readonly [...Step[], Checkpoint] {
    const last = checkpoint.safeParse(steps.at(-1));
    if (!last.success) {
        context.addIssue({ code: 'custom', message: 'Interaction completion must end with an output checkpoint.' });
        return z.NEVER;
    }
    return [ ...steps.slice(0, -1), last.data ];
}

const pipeExit = z.strictObject({
    kind: z.literal('exit'),
    readiness: pipeMarker.nullable(),
    steps: z.array(pipeStep),
    expectedExitCodes: z.tuple([ z.number().int().nonnegative() ]).rest(z.number().int().nonnegative())
});
const terminalExit = pipeExit.extend({ readiness: terminalMarker.nullable(), steps: z.array(terminalStep) });
const pipeInteractionCompletion = z.strictObject({
    kind: z.literal('interaction'),
    readiness: pipeMarker.nullable(),
    steps: z.array(pipeStep).transform(function finalPipeCheckpoint(steps, context) {
        return endingWithCheckpoint(steps, pipeCheckpoint, context);
    })
});
const terminalInteractionCompletion = pipeInteractionCompletion.extend({
    readiness: terminalMarker.nullable(),
    steps: z.array(terminalStep).transform(function finalTerminalCheckpoint(steps, context) {
        return endingWithCheckpoint(steps, terminalCheckpoint, context);
    })
});
export const pipeCompletionSchema = z.discriminatedUnion('kind', [
    pipeExit,
    z.strictObject({ kind: z.literal('ready'), marker: pipeMarker }),
    pipeInteractionCompletion
]);
export const terminalCompletionSchema = z.discriminatedUnion('kind', [
    terminalExit,
    z.strictObject({ kind: z.literal('ready'), marker: terminalMarker }),
    terminalInteractionCompletion
]);
export type ProcessMarker = ReadonlyDeep<z.infer<typeof pipeMarker | typeof terminalMarker>>;
export type ProcessStep = ReadonlyDeep<z.infer<typeof pipeStep | typeof terminalStep>>;
export type ProcessCompletion = ReadonlyDeep<z.infer<typeof pipeCompletionSchema | typeof terminalCompletionSchema>>;

export function validateInteractionNames(completed: ProcessCompletion): void {
    const steps = completed.kind === 'ready' ? [] : completed.steps;
    const names = steps.flatMap(function interactionNameForStep(step) {
        return step.kind === 'interaction' ? [ step.name ] : [];
    });
    const unique = new Set(names);
    if (unique.size !== names.length) {
        throw new TypeError('Process interactions require unique names.');
    }
}
