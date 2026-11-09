import { z } from 'zod';

const compilerSelectionSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('local') }).readonly(),
    z
        .strictObject({
            kind: z.literal('version'),
            version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u)
        })
        .readonly()
]);
export const typeTestSettingsSchema = z
    .strictObject({
        projectConfigPath: z.string().min(1),
        compiler: z.union([
            compilerSelectionSchema,
            z
                .strictObject({
                    kind: z.literal('matrix'),
                    compilers: z.tuple([ compilerSelectionSchema ]).rest(compilerSelectionSchema)
                })
                .readonly()
        ])
    })
    .readonly();
export type TypeTestOptions = z.input<typeof typeTestSettingsSchema>;

export type CompilerPolicy = TypeTestOptions['compiler'];
