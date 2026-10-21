import {
    attachBenchmarkCalibrationBody,
    type BenchmarkBody,
    type BenchmarkCalibrationBody
} from '../engine/benchmark-node.ts';
import type { ResolvableSourceLocations } from '../assertion-protocol/assertion-node-shape.ts';
import {
    attachComposedResourceActions,
    mapComposedResourceBody
} from '../packages/test/resource-wrapper-composition.ts';
import type { ResolvedBenchmarkDefinition } from './benchmark-definition-resolution.ts';
import { collectBenchmarkNormalization, calibrationResourceKey } from './benchmark-normalization.ts';
import type { MetricNormalization } from './calibration-definition.ts';

export function attachCalibrationResources(
    body: (scope: never) => unknown,
    rules: Readonly<Record<string, MetricNormalization>>
): (scope: never) => unknown {
    if (Object.keys(rules).length === 0) {
        return body;
    }
    const resources: Record<string, MetricNormalization['calibration']> = {};
    for (const rule of Object.values(rules)) {
        const key = calibrationResourceKey(rule);
        if (resources[key] !== undefined && resources[key] !== rule.calibration) {
            throw new TypeError('Reuse one calibration resource for each workload identity.');
        }
        resources[key] = rule.calibration;
    }
    return attachComposedResourceActions([ { kind: 'resources', resources } ], body, 'calibratedMeasurement');
}

function calibrationCaptureBody(
    definition: ResolvedBenchmarkDefinition,
    locations: ResolvableSourceLocations
): BenchmarkCalibrationBody {
    const resourceBody = attachCalibrationResources(function calibrationResources() {
        return undefined;
    }, definition.normalization);
    return {
        resourceBody,
        async body(scope) {
            const envelope = mapComposedResourceBody(
                resourceBody,
                async function captureReferences(_body, context) {
                    const normalization = await collectBenchmarkNormalization(
                        scope,
                        Reflect.get(context, 'resources'),
                        definition.normalization,
                        definition.summary.policy
                    );
                    await scope.updateResult({
                        timeline: null,
                        normalization,
                        lifecycle: null,
                        workload: scope.workload,
                        policy: definition.summary.policy,
                        samples: 0,
                        status: 'complete',
                        assumption: 'independent-stationary-observations',
                        metrics: {},
                        budgets: [],
                        rawSamples: {
                            status: 'omitted',
                            reference: null,
                            reason: 'Calibration capture does not measure benchmark samples.'
                        }
                    });
                    return [ {
                        actual: normalization === null || normalization.calibrations.length > 0,
                        check: 'true',
                        sourceLocations: locations,
                        source: 'assert',
                        message: 'Calibration resources produced comparable reference samples.'
                    } ];
                },
                'calibrationCapture',
                null
            );
            return await envelope(scope);
        }
    };
}

export function attachCalibrationExecution(
    body: BenchmarkBody,
    definition: ResolvedBenchmarkDefinition,
    locations: ResolvableSourceLocations
): void {
    attachBenchmarkCalibrationBody(body, calibrationCaptureBody(definition, locations));
}
