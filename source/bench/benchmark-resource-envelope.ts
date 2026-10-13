import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { ResolvableSourceLocations } from '../assertion-protocol/assertion-node-shape.ts';
import type { BenchmarkBody, BenchmarkScope } from '../engine/test-node.ts';
import { mapComposedResourceBody } from '../packages/test/resource-wrapper-composition.ts';
import { resolveTestBodyWorkload } from '../engine/test-body.ts';
import { workload } from './workload.ts';
import { sampleBenchmark } from './benchmark-sampling.ts';
import type { ResolvedBenchmarkDefinition } from './benchmark-definition-resolution.ts';

function allowedMeasurementField([ name ]: readonly [string, unknown]): boolean {
    return ![
        'assert',
        'require',
        'plan',
        'drainMicrotasks',
        'settleAsyncWork',
        'startInFlight',
        'yieldToNextTurn',
        'updateResult',
        'reportError'
    ]
        .includes(name);
}

export function benchmarkResourceEnvelope(
    measure: (scope: never) => unknown,
    definition: ResolvedBenchmarkDefinition,
    locations: ResolvableSourceLocations
): BenchmarkBody {
    return async function executeBenchmark(scope: BenchmarkScope): Promise<AssertionResult> {
        const selected = definition.summary.workloads.find(function selectedWorkload(work) {
            return work.name === scope.workload.name;
        });
        const budgets = definition.budgets.get(scope.workload.name);
        if (selected === undefined || budgets === undefined) {
            throw new TypeError('Selected workload is absent from the benchmark definition.');
        }
        const envelope = mapComposedResourceBody(
            resolveTestBodyWorkload(measure, { id: scope.workload, parameters: selected.parameters }),
            async function sampleResourceEnvelope(body, context) {
                return await sampleBenchmark({
                    body,
                    context: Object.fromEntries(Object.entries(context).filter(allowedMeasurementField)),
                    scope,
                    workload: workload(selected.name, selected.parameters),
                    measurement: definition.measurement,
                    budgets,
                    diagnostics: definition.summary.diagnostics,
                    policy: definition.summary.policy,
                    locations
                });
            },
            'benchmark'
        );
        const resourceScope = { ...scope, workload: workload(selected.name, selected.parameters) };
        return await envelope(resourceScope);
    };
}
