import { z } from 'zod/v4';
import { parse } from '@schema-hub/zod-error-formatter';
import { ConfigError } from '../run/config.entry-point.ts';
import { createRandomRunSeed } from '../run/run.entry-point.ts';

const seedSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u, 'must be a nonnegative decimal integer');

const workerOptionsSchema = z
    .strictObject({
        configPath: z.string().regex(/\S/u, 'must not be blank').nullable().default(null),
        paths: z.array(z.string().regex(/\S/u, 'must not be blank')).readonly().default([]),
        profile: z.string().nullable().default(null),
        freshState: z.boolean().default(false),
        seed: seedSchema
    });

const runnerOptionsSchema = workerOptionsSchema.readonly();

export type OverkillRunnerOptions = z.output<typeof runnerOptionsSchema>;

const campaignSeed = createRandomRunSeed().toString();
const campaignOptionsSchema = workerOptionsSchema
    .extend({ seed: seedSchema.default(campaignSeed) })
    .default({ configPath: null, paths: [], profile: null, freshState: false, seed: campaignSeed });

export const strykerValidationSchema = {
    type: 'object' as const,
    properties: {
        overkill: z.toJSONSchema(campaignOptionsSchema, { target: 'draft-7', io: 'input' })
    }
};

export function parseRunnerOptions(value: unknown): OverkillRunnerOptions {
    try {
        return parse(runnerOptionsSchema, value);
    } catch (error: unknown) {
        throw new ConfigError(`Invalid overkill Stryker settings: ${String(error)}`, { cause: error });
    }
}
