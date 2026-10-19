import { z } from 'zod/v4';
import type { Except, ReadonlyDeep } from 'type-fest';
import { pipeCompletionSchema, terminalCompletionSchema, validateInteractionNames } from './process-script.ts';

const argument = z.string().refine(function containsNoNull(value) {
    return !value.includes('\0');
}, 'Process arguments cannot contain null bytes.');
const command = {
    command: z.tuple([ argument.min(1) ]).rest(argument),
    cwd: argument.min(1),
    env: z.record(z.string().min(1).regex(/^[^=\0]+$/u), argument).nullable()
};

export const processRequestSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('pipes'),
        ...command,
        completion: pipeCompletionSchema
    }),
    z.strictObject({
        kind: z.literal('pty'),
        ...command,
        completion: terminalCompletionSchema,
        name: argument.min(1),
        columns: z.number().int().positive(),
        rows: z.number().int().positive()
    })
]);

export type ProcessCommand = ReadonlyDeep<z.infer<typeof processRequestSchema>>;
type PipeCommand = Extract<ProcessCommand, { readonly kind: 'pipes'; }>;
type TerminalCommand = Extract<ProcessCommand, { readonly kind: 'pty'; }>;
type PipeRequest = Except<PipeCommand, 'kind'> & { readonly io: { readonly kind: 'pipes'; }; };
type TerminalRequest = Except<TerminalCommand, 'columns' | 'kind' | 'name' | 'rows'> & {
    readonly io: { readonly kind: 'pty'; readonly name: string; readonly columns: number; readonly rows: number; };
};
export type ProcessRequest = PipeRequest | TerminalRequest;

export function parseProcessRequest(request: ProcessRequest): ProcessCommand {
    const { io, ...common } = request;
    const parsed = processRequestSchema.parse({ ...common, ...io });
    validateInteractionNames(parsed.completion);
    return parsed;
}
