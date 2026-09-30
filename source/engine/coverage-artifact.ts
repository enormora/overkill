import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { RuntimeId, WorkloadId } from './identity.ts';

export type CoverageMetric = {
    readonly covered: number;
    readonly total: number;
};

export type CoverageReportFile = {
    readonly format: 'lcov' | 'v8';
    readonly path: string;
};

export type CoverageArtifactPayload = {
    readonly completeness: 'complete';
    readonly directory: string;
    readonly kind: 'coverage';
    readonly rawDataDirectory: string;
    readonly reports: NonEmptyReadonlyArray<CoverageReportFile>;
    readonly summary: {
        readonly branches: CoverageMetric;
        readonly functions: CoverageMetric;
        readonly lines: CoverageMetric;
    };
};

export type CoverageArtifact = {
    readonly id: {
        readonly runtimes: readonly RuntimeId[];
        readonly scope: { readonly kind: 'run'; };
        readonly sequence: number;
        readonly subtype: 'coverage';
        readonly workload: WorkloadId | null;
    };
    readonly payload: CoverageArtifactPayload;
    readonly source: 'v8-native';
};
