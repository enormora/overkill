import { z } from 'zod';

export const typeTestSettingsSchema = z
    .strictObject({
        projectConfigPath: z.string().min(1),
        compiler: z.discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('local') }).readonly(),
            z
                .strictObject({
                    kind: z.literal('version'),
                    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u)
                })
                .readonly()
        ])
    })
    .readonly();
export type TypeTestOptions = z.input<typeof typeTestSettingsSchema>;
