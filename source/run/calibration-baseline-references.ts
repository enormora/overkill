import { createPerformanceBaselineStore, type PerformanceBaselineStore } from '../baselines/performance-store.ts';
import {
    normalizedPerformanceBaselineVersion,
    type StoredPerformanceBaseline
} from '../baselines/performance-baseline.ts';
import type { SavedCalibration } from '../engine/benchmark-result.ts';
import type { BenchmarkProfileConfig } from '../config/types.ts';

type ReferenceLookup = {
    readonly profile: BenchmarkProfileConfig;
    readonly profileName: string;
    readonly projectRoot: string;
    readonly purpose: 'capture' | 'compare';
};
function selectedBaseline(input: ReferenceLookup, baseline: StoredPerformanceBaseline): boolean {
    return baseline.profile === input.profileName &&
        input.profile.baselines.adapters.some(function selectedAdapter(adapter) {
            return adapter.id === baseline.adapter;
        });
}
function storedReferences(baseline: StoredPerformanceBaseline): readonly SavedCalibration[] {
    if (baseline.version !== normalizedPerformanceBaselineVersion || baseline.normalization === null) {
        return [];
    }
    return Object.entries(baseline.normalization.metrics).map(function metric([ name, evidence ]) {
        return {
            work: baseline.work,
            metric: name,
            reference: evidence.reference,
            budgetReference: evidence.budgetReference
        };
    });
}
async function readReferences(
    input: ReferenceLookup,
    store: PerformanceBaselineStore
): Promise<readonly SavedCalibration[]> {
    const expected = await store.list();
    return expected.flatMap(function savedReferences(entry) {
        return selectedBaseline(input, entry.baseline) ? storedReferences(entry.baseline) : [];
    });
}
export async function readSavedCalibrationReferences(input: ReferenceLookup): Promise<readonly SavedCalibration[]> {
    if (input.purpose === 'capture' || input.profile.baselines.adapters.length === 0) {
        return [];
    }
    const store = await createPerformanceBaselineStore({
        projectRoot: input.projectRoot,
        directory: input.profile.baselines.directory,
        maxBytes: input.profile.attachments.maxArtifactBytes
    });
    return await readReferences(input, store);
}
