import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import {
    ordinaryBaselineIdentity,
    type StoredOrdinaryBaseline,
    type OrdinaryBaselineChange
} from '../run/baseline-record.ts';
import type { OrdinaryBaselineStore } from '../run/baseline-store.ts';
import { createBaselinePublication } from '../run/baseline-publication.ts';

export function memoryOrdinaryBaselines(initial: readonly StoredOrdinaryBaseline[]): OrdinaryBaselineStore {
    const records = new Map(initial.map(function entry(baseline) {
        return [ baselineIdentityKey(ordinaryBaselineIdentity(baseline)), baseline ];
    }));
    async function apply(change: OrdinaryBaselineChange): Promise<void> {
        const key = baselineIdentityKey(ordinaryBaselineIdentity(change.baseline));
        if (change.kind === 'remove') {
            records.delete(key);
        } else {
            records.set(key, change.baseline);
        }
    }
    async function validate(): Promise<void> {
        return undefined;
    }
    return {
        apply,
        validate,
        async list() {
            return Array.from(records, function entry([ path, baseline ]) {
                return { path, baseline };
            });
        },
        publish: createBaselinePublication({
            apply,
            validate,
            async acquire() {
                return async function release() {
                    return undefined;
                };
            }
        })
    };
}
