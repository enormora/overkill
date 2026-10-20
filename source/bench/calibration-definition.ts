import type { BenchmarkScope } from '../engine/test-node.ts';
import type {
    BenchmarkLifecyclePolicy,
    MetricReading,
    SamplingPolicy,
    CalibrationIdentity,
    CalibrationResult
} from '../engine/benchmark-result.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceCreationContext,
    ResourceDependencies
} from '../packages/resources/resources.entry-point.ts';
import type { UncalibratedMeasurement, SampleForStrategy } from './measurement-definition.ts';
import type { BenchmarkSample } from './benchmark-definition.ts';
import type { Workload } from './workload.ts';

export type CalibrationSession = {
    readonly collect: (scope: BenchmarkScope) => Promise<CalibrationResult>;
};
export type CalibrationResource = AnyResourceDefinition & {
    readonly garbageCollection: BenchmarkLifecyclePolicy['garbageCollection'];
    readonly calibration: CalibrationIdentity;
    readonly acquire: (context: never) => CalibrationSession | Promise<CalibrationSession>;
};
export type CalibrationOptions = {
    readonly sampling: SamplingPolicy;
    readonly lifecycle: BenchmarkLifecyclePolicy;
};
export type CalibrationMeasureContext<Dependencies extends ResourceDependencies, Sample> = {
    readonly attachments: ResourceCreationContext<Dependencies>['attachments'];
    readonly dependencies: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
    readonly cleanup: BenchmarkScope['cleanup'];
    readonly sample: BenchmarkSample<Sample>;
};
export type CalibrationDefinition<Dependencies extends ResourceDependencies, Strategy extends UncalibratedMeasurement> =
    {
        readonly workload: Workload;
        readonly version: string;
        readonly unit: string;
        readonly dependencies: Dependencies;
        readonly measurement: Strategy;
        readonly measure: (
            context: CalibrationMeasureContext<Dependencies, SampleForStrategy<Strategy>>
        ) => MetricReading | Promise<MetricReading>;
    };

export type MetricNormalization = {
    readonly calibration: CalibrationResource;
    readonly scaling: 'inverse' | 'proportional';
};
