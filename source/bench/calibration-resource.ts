import { resolveBenchmarkGarbageCollection } from '../engine/benchmark-garbage-collection.ts';
import { defineResource, type ResourceDependencies } from '../packages/resources/resources.entry-point.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { CalibrationResult } from '../engine/benchmark-result.ts';
import { resolveBenchmarkLifecyclePolicy } from './benchmark-lifecycle-policy.ts';
import { defaultSamplingPolicy, validateSamplingPolicy } from './sampling-policy.ts';
import { sampleCalibration } from './calibration-sampling.ts';
import type { UncalibratedMeasurement } from './measurement-definition.ts';
import type {
    CalibrationDefinition,
    CalibrationResource,
    CalibrationOptions,
    CalibrationSession
} from './calibration-definition.ts';
import { workloadIdentity, workload } from './workload.ts';

export function defineCalibrationResource<
    const Dependencies extends ResourceDependencies,
    Strategy extends UncalibratedMeasurement
>(
    definition: CalibrationDefinition<Dependencies, Strategy>,
    ...configuration: readonly [] | readonly [CalibrationOptions]
): CalibrationResource {
    const options = configuration[0] ?? {
        sampling: defaultSamplingPolicy,
        lifecycle: resolveBenchmarkLifecyclePolicy(undefined)
    };
    const policy = validateSamplingPolicy(options.sampling);
    const lifecycle = resolveBenchmarkLifecyclePolicy(options.lifecycle);
    const referenceWorkload = workload(definition.workload.name, definition.workload.parameters);
    const { measure } = definition;
    if (
        Object.hasOwn(definition.measurement, 'kind') || definition.version.trim().length === 0 ||
        definition.unit.trim().length === 0
    ) {
        throw new TypeError('Calibration requires an explicit version and unit.');
    }
    const identity = Object.freeze({
        workload: workloadIdentity(referenceWorkload),
        version: definition.version,
        unit: definition.unit
    });
    const resource = defineResource({
        name: `calibration:${canonicalIdentityJson(identity)}`,
        scope: 'shared-per-worker',
        dependencies: definition.dependencies,
        requirements: [ { kind: 'single-worker' } ],
        dispose: null,
        acquire(context): CalibrationSession {
            let pending: Promise<CalibrationResult> | null = null;
            return {
                async collect(scope) {
                    pending = pending ?? sampleCalibration(identity, {
                        lifecycle: {
                            ...lifecycle,
                            garbageCollection: resolveBenchmarkGarbageCollection(
                                lifecycle.garbageCollection,
                                scope.benchmarkEnvironment?.profileGarbageCollection ?? 'off'
                            )
                        },
                        body: async function readReference(measureContext: never) {
                            return { reference: await measure(measureContext) };
                        },
                        context: { dependencies: context.dependencies, attachments: context.attachments },
                        scope,
                        workload: referenceWorkload,
                        measurement: definition.measurement,
                        budgets: [],
                        diagnostics: [ 'reference' ],
                        policy
                    });
                    return pending;
                }
            };
        }
    });
    return Object.freeze({ ...resource, calibration: identity, garbageCollection: lifecycle.garbageCollection });
}
