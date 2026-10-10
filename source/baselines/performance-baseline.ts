import type {
    BenchmarkCalibrationResult as BenchmarkCalibrationResultDefinition
} from '../packages/run/benchmark-calibration.entry-point.ts';
import type { WorkId } from '../engine/identity.ts';
import type { PerformanceBaselineValue } from './performance-adapter.ts';

export type BaselineSubtype = 'content-snapshot' | 'performance-baseline' | 'terminal-snapshot' | 'visual-snapshot';
export type PerformanceBaselineIdentity = {
    readonly adapter: string;
    readonly machineClass: string;
    readonly profile: string;
    readonly work: WorkId;
};
export type StoredPerformanceBaseline = {
    readonly adapter: string;
    readonly expected: PerformanceBaselineValue;
    readonly profile: string;
    readonly subtype: 'performance-baseline';
    readonly version: 1;
    readonly work: WorkId;
};
export type BaselineEntry = {
    readonly baseline: StoredPerformanceBaseline;
    readonly path: string;
};
type CreatedBaseline = { readonly baseline: StoredPerformanceBaseline; readonly kind: 'create'; };
type RemovedBaseline = { readonly baseline: StoredPerformanceBaseline; readonly kind: 'remove'; };
type UpdatedBaseline = {
    readonly baseline: StoredPerformanceBaseline;
    readonly kind: 'update';
    readonly previous: StoredPerformanceBaseline;
};
export type BaselineChange = CreatedBaseline | RemovedBaseline | UpdatedBaseline;
type WrittenBaselines = { readonly changes: readonly BaselineChange[]; readonly kind: 'written'; };
type BlockedBaselineWrites = { readonly kind: 'blocked'; };
type FailedBaselineWrites = { readonly kind: 'failed'; readonly writtenChanges: readonly BaselineChange[]; };
type ReadOnlyBaselines = { readonly kind: 'read-only'; };
export type BaselineWriteOutcome = BlockedBaselineWrites | FailedBaselineWrites | ReadOnlyBaselines | WrittenBaselines;
export type BaselineUpdateMode = 'apply' | 'bootstrap' | 'diff' | 'none' | 'update';

export function performanceBaselineIdentity(baseline: StoredPerformanceBaseline): PerformanceBaselineIdentity {
    return {
        adapter: baseline.adapter,
        machineClass: baseline.expected.calibration.machineClass,
        profile: baseline.profile,
        work: baseline.work
    };
}

export type BenchmarkCalibrationResult = BenchmarkCalibrationResultDefinition;
