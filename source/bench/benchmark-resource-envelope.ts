import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { ResolvableSourceLocations } from '../assertion-protocol/assertion-node-shape.ts';
import type { BenchmarkBody, BenchmarkScope } from '../engine/test-node.ts';
import { mapComposedResourceBody } from '../packages/test/resource-wrapper-composition.ts';
import { readTestBodyFamily, resolveTestBodyWorkload } from '../engine/test-body.ts';
import { directBenchmarkEnvironment, benchmarkLifecyclePolicy } from './benchmark-execution-context.ts';
import { collectBenchmarkNormalization } from './benchmark-normalization.ts';
import { workload } from './workload.ts';
import { sampleBenchmark } from './benchmark-sampling.ts';
import type { ResolvedBenchmarkDefinition } from './benchmark-definition-resolution.ts';

function allowedMeasurementField([ name ]: readonly [string, unknown]): boolean {
    return ![
        'benchmarkEnvironment',
        'assert',
        'require',
        'plan',
        'drainMicrotasks',
        'settleAsyncWork',
        'startInFlight',
        'yieldToNextTurn',
        'updateResult',
        'reportError',
        'reportCleanupError'
    ]
        .includes(name);
}

function measurementContext(context: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const fields = Object.entries(context).filter(allowedMeasurementField);
    const resources = Reflect.get(context, 'resources');
    if (typeof resources !== 'object' || resources === null) {
        return Object.fromEntries(fields);
    }
    return {
        ...Object.fromEntries(fields),
        resources: Object.fromEntries(
            Object.entries(resources).filter(function publicResource([ name ]) {
                return !name.startsWith('calibration:');
            })
        )
    };
}

export function benchmarkResourceEnvelope(
    measure: (scope: never) => unknown,
    definition: ResolvedBenchmarkDefinition,
    locations: ResolvableSourceLocations
): BenchmarkBody {
    return async function executeBenchmark(original: BenchmarkScope): Promise<AssertionResult> {
        const scope = directBenchmarkEnvironment(original);
        const selected = definition.summary.workloads.find(function selectedWorkload(work) {
            return work.name === scope.workload.name;
        });
        const budgets = definition.budgets.get(scope.workload.name);
        if (selected === undefined || budgets === undefined) {
            throw new TypeError('Selected workload is absent from the benchmark definition.');
        }
        const selectedBody = resolveTestBodyWorkload(measure, { id: scope.workload, parameters: selected.parameters });
        const envelope = mapComposedResourceBody(
            selectedBody,
            async function sampleResourceEnvelope(body, context) {
                const normalization = await collectBenchmarkNormalization(
                    scope,
                    Reflect.get(context, 'resources'),
                    definition.normalization,
                    definition.summary.policy
                );
                return await sampleBenchmark({
                    normalization,
                    lifecycle: benchmarkLifecyclePolicy(definition.lifecycle, scope),
                    body,
                    context: measurementContext(context),
                    scope,
                    workload: workload(selected.name, selected.parameters),
                    measurement: definition.measurement,
                    budgets,
                    diagnostics: definition.summary.diagnostics,
                    policy: definition.summary.policy,
                    locations
                });
            },
            'benchmark',
            readTestBodyFamily(selectedBody)
        );
        const resourceScope = { ...scope, workload: workload(selected.name, selected.parameters) };
        return await envelope(resourceScope);
    };
}
