import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray, ResolvableSourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { BodyImplementation } from './test-body.ts';
import type { BenchmarkExecutionEnvironment } from './benchmark-environment.ts';
import type { BenchmarkDefinitionSummary, BenchmarkExecutionResult } from './benchmark-result.ts';
import type { WorkId, WorkloadId, AttemptId } from './identity.ts';
import type { CaseRunnerError } from './run-result.ts';
import type { TestAnnotationsInput, TestControlsInput } from './test-data.ts';

export type BenchmarkScope = {
    readonly workId: WorkId;
    readonly attemptId: AttemptId;
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
    readonly resourceBody: BodyImplementation<never, unknown>;
    readonly definition: BenchmarkDefinitionSummary;
    readonly body: BodyImplementation<BenchmarkScope, ReturnType<BenchmarkBody>>;
    readonly bodyMode: 'benchmark';
    readonly kind: 'body';
    readonly workloads: readonly WorkloadId[];
};
export type BenchmarkTestCaseOptions = {
    readonly resourceBody: BodyImplementation<never, unknown>;
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
    readonly definitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
    readonly title: string;
    readonly definition: BenchmarkDefinitionSummary;
    readonly body: BodyImplementation<BenchmarkScope, ReturnType<BenchmarkBody>>;
    readonly workloads: readonly WorkloadId[];
};

const benchmarkCalibrationBody = Symbol.for('@overkill-dev/engine/BenchmarkCalibrationBody');
export type BenchmarkCalibrationBody = {
    readonly body: BodyImplementation<BenchmarkScope, ReturnType<BenchmarkBody>>;
    readonly resourceBody: BodyImplementation<never, unknown>;
};
type CalibrationAttachedBody = BodyImplementation<BenchmarkScope, ReturnType<BenchmarkBody>> & {
    readonly [benchmarkCalibrationBody]: BenchmarkCalibrationBody;
};
function hasCalibrationBody(
    body: BodyImplementation<BenchmarkScope, ReturnType<BenchmarkBody>>
): body is CalibrationAttachedBody {
    return Object.hasOwn(body, benchmarkCalibrationBody);
}
export function attachBenchmarkCalibrationBody(
    body: BodyImplementation<BenchmarkScope, ReturnType<BenchmarkBody>>,
    calibration: BenchmarkCalibrationBody
): void {
    Object.defineProperty(body, benchmarkCalibrationBody, { value: Object.freeze(calibration) });
}
export function readBenchmarkCalibrationBody(
    body: BodyImplementation<BenchmarkScope, ReturnType<BenchmarkBody>>
): BenchmarkCalibrationBody | null {
    return hasCalibrationBody(body) ? body[benchmarkCalibrationBody] : null;
}
