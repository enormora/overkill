import {
    createBenchmarkTestCase,
    type TestCase
} from '../packages/engine/engine.entry-point.ts';
import { definitionLocationsForAuthoringCall } from '../packages/test/authoring-source-locations.ts';
import { attachCalibrationResources, attachCalibrationExecution } from './calibration-resource-body.ts';
import type { BenchmarkDefinition, BenchmarkOptions } from './benchmark-definition.ts';
import { benchmarkResourceEnvelope } from './benchmark-resource-envelope.ts';
import { resolveBenchmarkDefinition } from './benchmark-definition-resolution.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';
import { workloadIdentity, type Workload } from './workload.ts';
import type { UncalibratedMeasurement as Strategy, SampleForStrategy } from './measurement-definition.ts';

type AuthoredBenchmark<
    Workloads extends readonly Workload[],
    Measurement extends Strategy
> = BenchmarkDefinition<Workloads[number]['parameters'], SampleForStrategy<Measurement>, Measurement> & {
    readonly workloads: Workloads;
};

export function benchmark<
    const Workloads extends readonly Workload[],
    Measurement extends Strategy
>(
    title: string,
    definition: AuthoredBenchmark<Workloads, Measurement>,
    ...configuration: readonly [] | readonly [BenchmarkOptions]
): TestCase {
    if (typeof definition.measure !== 'function') {
        throw new TypeError('Benchmark requires a measure function.');
    }
    const options = configuration[0] ?? { annotations: {}, controls: {}, sampling: defaultSamplingPolicy };
    const resolved = resolveBenchmarkDefinition(definition, options);
    const locations = definitionLocationsForAuthoringCall();
    const resourceBody = attachCalibrationResources(definition.measure, resolved.normalization);
    const body = benchmarkResourceEnvelope(resourceBody, resolved, locations);
    attachCalibrationExecution(body, resolved, locations);
    return createBenchmarkTestCase({
        resourceBody,
        definition: resolved.summary,
        annotations: options.annotations,
        body,
        controls: options.controls,
        definitionLocations: locations,
        title,
        workloads: resolved.summary.workloads.map(workloadIdentity)
    });
}
