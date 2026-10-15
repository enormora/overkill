import { z } from 'zod/v4';
import { createRandomRunSeed } from '../run/run.entry-point.ts';
import { campaignReceiver } from './campaign-receiver.ts';
import { isStrykerWorker } from './instrumentation-context.entry-point.ts';
import { seedSchema, workerOptionsSchema } from './runner-settings-schema.ts';

const campaignSeed = createRandomRunSeed().toString();
export const defaultCampaignEndpoint = isStrykerWorker()
    ? null
    : await campaignReceiver();
const campaignOptionsSchema = workerOptionsSchema
    .extend({ seed: seedSchema.default(campaignSeed) })
    .default({ configPath: null, paths: [], profile: null, freshState: false, seed: campaignSeed });

export const strykerValidationSchema = {
    type: 'object' as const,
    properties: {
        overkillCampaign: {
            type: 'object' as const,
            properties: { port: { type: 'integer' as const }, token: { type: 'string' as const } },
            additionalProperties: false,
            required: [ 'port', 'token' ],
            ...defaultCampaignEndpoint === null ? {} : { default: defaultCampaignEndpoint }
        },
        overkill: z.toJSONSchema(campaignOptionsSchema, { target: 'draft-7', io: 'input' })
    }
};
