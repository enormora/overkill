import { z } from 'zod/v4';
import {
    isBuiltinTestProfile,
    type ProfileConfig,
    type BuiltinTestProfileConfig,
    type BenchmarkProfileConfig
} from '../config/types.ts';
import { normalizeWorkDistribution } from '../config/work-distribution.ts';
import { normalizedMicrotestProfileSchema } from '../config/normalized-microtest-schema.ts';
import { integrationExecutionSchema } from '../config/schema.ts';
import { attachmentLimitsSchema } from '../config/evidence-policy.ts';
import { propertyPolicySchema } from '../engine/property-policy.ts';
import { propertyCorpusPolicySchema } from '../config/property-corpus.ts';
import { benchmarkHostPolicySchema } from '../config/benchmark-host.ts';
import { recordedBaselinePolicySchema, restoreRecordedBaselines } from './recorded-baseline-policy.ts';

const common = normalizedMicrotestProfileSchema.omit({ coverage: true, execution: true, testFamily: true }).extend({
    baselines: recordedBaselinePolicySchema
});
const worker = integrationExecutionSchema.options[1].unwrap().required();
const distribution = worker.shape.workDistribution;
const workDistribution = distribution.transform(function normalize(value) {
    return normalizeWorkDistribution({ processModel: 'worker-pool', workDistribution: value }, { mode: 'file' });
});
const hostProcess = z.union([
    z.strictObject({ kind: z.literal('direct') }),
    z.strictObject({ kind: z.literal('child'), nodeArguments: z.array(z.string()) })
]);
export const recordedIntegrationExecutionSchema = z.union([
    integrationExecutionSchema.options[0].unwrap().required(),
    worker.extend({ maxWorkers: z.number().int().positive().nullable(), hostProcess, workDistribution })
]);
const integration = common.extend({
    testFamily: z.literal('integration'),
    files: common.shape.files.unwrap(),
    execution: recordedIntegrationExecutionSchema,
    attachments: attachmentLimitsSchema,
    retries: z
        .strictObject({
            maxAttempts: z.number().int().positive(),
            artifacts: z.enum([ 'all', 'first-failure-and-final', 'last-failure-and-final' ])
        })
        .nullable()
});
const benchmarkExecution = z.union([
    integrationExecutionSchema.options[0].unwrap().required().extend({
        maxConcurrency: z.literal(1),
        scheduling: z.literal('serial')
    }),
    worker.extend({
        maxConcurrency: z.literal(1),
        scheduling: z.literal('serial'),
        maxWorkers: z.number().int().positive().nullable(),
        hostProcess,
        workDistribution,
        hedging: z.strictObject({ mode: z.literal('off') })
    })
]);
const recordedProfileSchema = z.union([
    normalizedMicrotestProfileSchema.extend({ baselines: recordedBaselinePolicySchema }),
    common.extend({
        testFamily: z.literal('property'),
        files: common.shape.files.unwrap(),
        execution: normalizedMicrotestProfileSchema.shape.execution,
        property: propertyPolicySchema,
        corpus: propertyCorpusPolicySchema
    }),
    integration,
    common.extend({
        testFamily: z.literal('benchmark'),
        files: common.shape.files.unwrap(),
        execution: benchmarkExecution,
        attachments: attachmentLimitsSchema,
        garbageCollection: z.enum([ 'off', 'after-sample' ]),
        host: benchmarkHostPolicySchema,
        baselines: z.strictObject({ directory: z.string(), adapters: z.array(z.object({ id: z.string() })) })
    })
]);

export function restoreReplayProfile(
    value: unknown,
    current: ProfileConfig | undefined
): BenchmarkProfileConfig | BuiltinTestProfileConfig {
    const profile = recordedProfileSchema.parse(value);
    const reporters = current?.reporters ?? null;
    if (profile.testFamily !== 'benchmark') {
        const policy = current !== undefined && isBuiltinTestProfile(current)
            ? current.baselines
            : { directory: 'test-baselines', adapters: [], snapshots: false, stale: 'fail' as const };
        return { ...profile, reporters, baselines: restoreRecordedBaselines(profile.baselines, policy) };
    }
    const adapters = profile.baselines.adapters.map(function bindAdapter(saved) {
        const adapter = current?.testFamily === 'benchmark'
            ? current.baselines.adapters.find(function sameIdentity(candidate) {
                return candidate.id === saved.id;
            })
            : undefined;
        if (adapter === undefined) {
            throw new TypeError(`Recorded baseline adapter is unavailable: ${saved.id}`);
        }
        return adapter;
    });
    return { ...profile, reporters, baselines: { ...profile.baselines, adapters } };
}
