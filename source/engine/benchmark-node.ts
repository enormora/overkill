import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray, ResolvableSourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { BenchmarkExecutionEnvironment } from './benchmark-environment.ts';
import type { BenchmarkDefinitionSummary, BenchmarkExecutionResult } from './benchmark-result.ts';
import type { WorkId, WorkloadId } from './identity.ts';
import type { CaseRunnerError } from './run-result.ts';
import type { TestAnnotationsInput, TestControlsInput } from './test-data.ts';

export type BenchmarkScope = {
    readonly workId: WorkId;
    readonly benchmarkEnvironment: BenchmarkExecutionEnvironment | null;
    readonly reportCleanupError: (error: unknown) => void;
    readonly cleanup: (callback: () => Promise<void> | void) => void;
    readonly signal: AbortSignal;
    readonly workload: WorkloadId;
    readonly updateResult: (result: BenchmarkExecutionResult) => Promise<void>;
    readonly reportError: (error: CaseRunnerError) => void;
};
export type BenchmarkBody = (scope: BenchmarkScope) => AssertionResult | Promise<AssertionResult>;
export type BenchmarkTestCaseExecution = {
    readonly resourceBody: (scope: never) => unknown;
    readonly definition: BenchmarkDefinitionSummary;
    readonly body: BenchmarkBody;
    readonly bodyMode: 'benchmark';
    readonly kind: 'body';
    readonly workloads: readonly WorkloadId[];
};
export type BenchmarkTestCaseOptions = {
    readonly resourceBody: (scope: never) => unknown;
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
    readonly definitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
    readonly title: string;
    readonly definition: BenchmarkDefinitionSummary;
    readonly body: BenchmarkBody;
    readonly workloads: readonly WorkloadId[];
};

const benchmarkCalibrationBody = Symbol.for('@overkill-dev/engine/BenchmarkCalibrationBody');
export type BenchmarkCalibrationBody = {
    readonly body: BenchmarkBody;
    readonly resourceBody: (scope: never) => unknown;
};
type CalibrationAttachedBody = BenchmarkBody & { readonly [benchmarkCalibrationBody]: BenchmarkCalibrationBody; };
function hasCalibrationBody(body: BenchmarkBody): body is CalibrationAttachedBody {
    return Object.hasOwn(body, benchmarkCalibrationBody);
}
export function attachBenchmarkCalibrationBody(body: BenchmarkBody, calibration: BenchmarkCalibrationBody): void {
    Object.defineProperty(body, benchmarkCalibrationBody, { value: Object.freeze(calibration) });
}
export function readBenchmarkCalibrationBody(body: BenchmarkBody): BenchmarkCalibrationBody | null {
    return hasCalibrationBody(body) ? body[benchmarkCalibrationBody] : null;
}
