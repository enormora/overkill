import { z } from 'zod/v4';
import { parse } from '@schema-hub/zod-error-formatter';
import { ConfigError } from '../run/config.entry-point.ts';

const runnerOptionsSchema = z
    .strictObject({
        configPath: z.string().regex(/\S/u, 'must not be blank').nullable().default(null),
        profile: z.string().nullable().default(null)
    })
    .readonly()
    .default({ configPath: null, profile: null });

export type OverkillRunnerOptions = z.output<typeof runnerOptionsSchema>;

export const strykerValidationSchema = {
    type: 'object' as const,
    properties: {
        overkill: z.toJSONSchema(runnerOptionsSchema, { target: 'draft-7', io: 'input' })
    }
};

export function parseRunnerOptions(value: unknown): OverkillRunnerOptions {
    try {
        return parse(runnerOptionsSchema, value);
    } catch (error: unknown) {
        throw new ConfigError(`Invalid overkill Stryker settings: ${String(error)}`, { cause: error });
    }
}
