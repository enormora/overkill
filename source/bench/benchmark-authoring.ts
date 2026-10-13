import {
    createBenchmarkTestCase,
    type TestCase
} from '../packages/engine/engine.entry-point.ts';
import { definitionLocationsForAuthoringCall } from '../packages/test/authoring-source-locations.ts';
import type { BenchmarkDefinition, BenchmarkOptions } from './benchmark-definition.ts';
import { benchmarkResourceEnvelope } from './benchmark-resource-envelope.ts';
import { resolveBenchmarkDefinition } from './benchmark-definition-resolution.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';
import { workloadIdentity, type Workload } from './workload.ts';
import type {
    AsyncMeasurementSample,
    AsyncMeasurementStrategy,
    MeasurementSample,
    MeasurementStrategy
} from './measurement-types.ts';

type StrategySamples = { readonly async: AsyncMeasurementSample; readonly sync: MeasurementSample; };
type SampleForStrategy<Strategy extends AsyncMeasurementStrategy | MeasurementStrategy> =
    StrategySamples[Strategy['mode']];
type AuthoredBenchmark<
    Workloads extends readonly Workload[],
    Strategy extends AsyncMeasurementStrategy | MeasurementStrategy
> = BenchmarkDefinition<Workloads[number]['parameters'], SampleForStrategy<Strategy>, Strategy> & {
    readonly workloads: Workloads;
};

export function benchmark<
    const Workloads extends readonly Workload[],
    Strategy extends AsyncMeasurementStrategy | MeasurementStrategy
>(
    title: string,
    definition: AuthoredBenchmark<Workloads, Strategy>,
    ...configuration: readonly [] | readonly [BenchmarkOptions]
): TestCase {
    if (typeof definition.measure !== 'function') {
        throw new TypeError('Benchmark requires a measure function.');
    }
    const options = configuration[0] ?? { annotations: {}, controls: {}, sampling: defaultSamplingPolicy };
    const resolved = resolveBenchmarkDefinition(definition, options);
    const locations = definitionLocationsForAuthoringCall();
    const body = benchmarkResourceEnvelope(definition.measure, resolved, locations);
    return createBenchmarkTestCase({
        resourceBody: definition.measure,
        definition: resolved.summary,
        annotations: options.annotations,
        body,
        controls: options.controls,
        definitionLocations: locations,
        title,
        workloads: resolved.summary.workloads.map(workloadIdentity)
    });
}
