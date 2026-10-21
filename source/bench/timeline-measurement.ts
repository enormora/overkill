import type { BenchmarkTimelinePolicy } from '../engine/benchmark-timeline.ts';
import { benchmarkTimelinePolicySchema } from './timeline-schema.ts';
import type { UncalibratedMeasurement } from './measurement-definition.ts';

export type TimelineMeasurement<Strategy extends UncalibratedMeasurement = UncalibratedMeasurement> = Strategy & {
    readonly timeline: BenchmarkTimelinePolicy;
};

export function timelineMeasurement<Strategy extends UncalibratedMeasurement>(
    strategy: Strategy,
    policy: BenchmarkTimelinePolicy
): TimelineMeasurement<Strategy> {
    if (Object.hasOwn(strategy, 'timeline')) {
        throw new TypeError('Measurement already declares a timeline policy.');
    }
    const traced = { ...strategy, timeline: Object.freeze(benchmarkTimelinePolicySchema.parse(policy)) };
    Object.freeze(traced);
    return traced;
}

export function measurementTimelinePolicy(strategy: UncalibratedMeasurement): BenchmarkTimelinePolicy | null {
    return Object.hasOwn(strategy, 'timeline')
        ? Object.freeze(benchmarkTimelinePolicySchema.parse(Reflect.get(strategy, 'timeline')))
        : null;
}
