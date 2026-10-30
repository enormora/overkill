import { z } from 'zod';

const defaultDetailedRunLimit = 20;
const defaultSuccessfulArtifactRunLimit = 5;
const defaultFailingArtifactRetentionDays = 7;
const defaultLockTimeout = 5000;
const defaultObservationLimit = 20;
const defaultSummaryLimit = 500;
const defaultRetentionDays = 90;
const defaultStaleLock = 120_000;
export const historyPolicySchema = z
    .strictObject({
        detailedRunLimit: z.number().int().nonnegative().default(defaultDetailedRunLimit),
        successfulArtifactRunLimit: z.number().int().nonnegative().default(defaultSuccessfulArtifactRunLimit),
        failingArtifactRetentionDays: z.number().nonnegative().default(defaultFailingArtifactRetentionDays),
        lockTimeoutMilliseconds: z.number().int().nonnegative().default(defaultLockTimeout),
        observationsPerIdentity: z.number().int().positive().default(defaultObservationLimit),
        runSummaryLimit: z.number().int().positive().default(defaultSummaryLimit),
        runSummaryRetentionDays: z.number().positive().default(defaultRetentionDays),
        staleIdentityRetentionDays: z.number().positive().default(defaultRetentionDays),
        staleLockMilliseconds: z.number().int().min(defaultLockTimeout).default(defaultStaleLock)
    })
    .readonly();

export type HistoryPolicy = z.output<typeof historyPolicySchema>;
export const defaultHistoryPolicy = historyPolicySchema.parse({});

export type ProjectHistoryPolicy = z.input<typeof historyPolicySchema>;
