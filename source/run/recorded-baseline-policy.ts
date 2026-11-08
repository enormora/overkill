import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import type { OrdinaryBaselinePolicy } from '../baselines/baseline-policy.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';

export const recordedBaselinePolicySchema = z
    .strictObject({
        directory: z.string(),
        stale: z.enum([ 'fail', 'warn' ]),
        adapters: z.array(z.strictObject({
            id: z.string(),
            subtype: z.enum([ 'content-snapshot', 'terminal-snapshot', 'visual-snapshot' ]),
            comparisonContext: z.record(z.string(), z.string())
        }))
    })
    .default({ directory: 'test-baselines', stale: 'fail', adapters: [] });
type RecordedBaselinePolicy = ReadonlyDeep<z.infer<typeof recordedBaselinePolicySchema>>;
export function restoreRecordedBaselines(
    saved: RecordedBaselinePolicy,
    current: OrdinaryBaselinePolicy
): OrdinaryBaselinePolicy {
    const adapters = saved.adapters.map(function bindAdapter(reference) {
        const adapter = current.adapters.find(function sameIdentity(candidate) {
            const contextMatches = canonicalIdentityJson(candidate.comparisonContext) ===
                canonicalIdentityJson(reference.comparisonContext);
            return candidate.id === reference.id && candidate.subtype === reference.subtype && contextMatches;
        });
        if (adapter === undefined) {
            throw new TypeError(`Recorded baseline adapter is unavailable: ${reference.id}`);
        }
        return adapter;
    });
    return { ...saved, adapters };
}
