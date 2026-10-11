import { createWorkloadTestCase } from '../../../packages/engine/engine.entry-point.ts';
import { workload, type Workload } from '../../../packages/bench/bench.entry-point.ts';
import {
    defineResource,
    defineRuntime,
    defineRuntimeMatrix,
    withResource,
    withRuntime,
    type RuntimeDefinition,
    type RuntimeTestScope
} from '../../../packages/test/resources.entry-point.ts';
import type { WorkloadTestCaseVariant, TestScope } from '../../../packages/engine/engine.entry-point.ts';

const variants: Readonly<Record<string, RuntimeDefinition>> = {
    left: defineRuntime({ name: 'left', dimensions: { flavor: 'left' }, resources: {}, requirements: [] }),
    right: defineRuntime({ name: 'right', dimensions: { flavor: 'right' }, resources: {}, requirements: [] })
};
const runtime = defineRuntimeMatrix({
    name: 'node',
    variants
});

function workloadBody(input: Workload<string, { readonly packages: number; }>): WorkloadTestCaseVariant {
    const resource = defineResource({
        name: `fixture-${input.name}`,
        scope: 'per-case',
        requirements: [],
        acquire() {
            return input.parameters.packages;
        },
        dispose: null
    });
    return {
        id: input.id,
        body: withRuntime<typeof runtime, TestScope>(
            runtime,
            withResource<typeof resource, RuntimeTestScope<typeof runtime>>(resource, async (scope) => {
                scope.assert.equal(scope.resources[resource.name], input.parameters.packages);
                await scope.attachments.json({ name: 'duration', mediaType: 'application/json' }, input.parameters.packages);
                return scope.assert.collect();
            })
        )
    };
}

export const testNode = createWorkloadTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'publish',
    workloads: [ workloadBody(workload('small', { packages: 5 })), workloadBody(workload('large', { packages: 50 })) ]
});
