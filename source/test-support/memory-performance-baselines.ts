import { performanceBaselineKey, type PerformanceBaselineStore } from '../baselines/performance-store.ts';
import { performanceBaselineIdentity, type StoredPerformanceBaseline } from '../baselines/performance-baseline.ts';

export function memoryPerformanceBaselines(initial: readonly StoredPerformanceBaseline[]): PerformanceBaselineStore {
    const records = new Map(initial.map(function keyed(baseline) {
        return [ performanceBaselineKey(performanceBaselineIdentity(baseline)), baseline ];
    }));
    return {
        async list() {
            return Array.from(records, function entry([ path, baseline ]) {
                return { path, baseline };
            });
        },
        async apply(change) {
            const key = performanceBaselineKey(performanceBaselineIdentity(change.baseline));
            if (change.kind === 'remove') {
                records.delete(key);
            } else {
                records.set(key, change.baseline);
            }
        }
    };
}
