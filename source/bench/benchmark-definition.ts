import type { WorkloadParameters } from '../engine/workload-parameters.ts';
import type { BenchmarkScope } from '../engine/test-node.ts';
import type { BenchmarkLifecyclePolicy, MetricReading, SamplingPolicy } from '../engine/benchmark-result.ts';
import type { AuthoringAnnotations, AuthoringControls } from '../packages/test/authoring-test-data.ts';
import type { BenchmarkTimeline } from '../engine/benchmark-timeline.ts';
import type { MeasurementSample, MeasurementStrategy } from './measurement-types.ts';
import type { MetricBudget } from './benchmark-budget-definition.ts';
import type { Workload } from './workload.ts';

type BenchmarkKinds = {
    readonly runtime: 'runtime';
    readonly throughput: 'throughput';
    readonly responsiveness: 'responsiveness';
    readonly startup: 'startup';
    readonly bundleSize: 'bundle-size';
    readonly browserPerformance: 'browser-performance';
    readonly memory: 'memory';
};
export type BenchmarkKind = BenchmarkKinds[keyof BenchmarkKinds];
export type BenchmarkMetrics = Readonly<Record<string, MetricReading | number>>;
export type BenchmarkSample<Sample> = Sample & {
    readonly timeline: BenchmarkTimeline;
    readonly cleanup: (callback: () => Promise<void> | void) => void;
};
export type BenchmarkMeasureContext<Parameters extends WorkloadParameters, Sample = MeasurementSample> = {
    readonly workload: Workload<string, Parameters>;
    readonly sample: BenchmarkSample<Sample>;
    readonly signal: AbortSignal;
    readonly cleanup: BenchmarkScope['cleanup'];
};
export type BenchmarkDefinition<
    Parameters extends WorkloadParameters,
    Sample = MeasurementSample,
    Strategy = MeasurementStrategy
> = {
    readonly kind: BenchmarkKind;
    readonly workloads: readonly Workload<string, Parameters>[];
    readonly measurement: Strategy;
    readonly measure: (
        context: BenchmarkMeasureContext<Parameters, Sample>
    ) => BenchmarkMetrics | Promise<BenchmarkMetrics>;
    readonly diagnosticMetrics: readonly string[];
    readonly budgets: Readonly<Record<string, Readonly<Record<string, MetricBudget | readonly MetricBudget[]>>>>;
};
export type BenchmarkOptions = {
    readonly lifecycle?: BenchmarkLifecyclePolicy;
    readonly annotations: AuthoringAnnotations;
    readonly controls: AuthoringControls;
    readonly sampling: SamplingPolicy;
};
