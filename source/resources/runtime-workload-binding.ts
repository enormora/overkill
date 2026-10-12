import { defineRuntime, type RuntimeDefinition } from './runtime-definition.ts';
import { runtimeMatrixDefinitionApi, type RuntimeGraph } from './runtime-matrix-definition.ts';
import type { WorkloadResourceBinding } from './resource-workload-binding.ts';

export function bindRuntimeWorkload(graph: RuntimeGraph, binding: WorkloadResourceBinding): RuntimeGraph {
    function bindRuntime(runtime: RuntimeDefinition): RuntimeDefinition {
        const bound: RuntimeDefinition = defineRuntime({
            dimensions: runtime.dimensions,
            name: runtime.name,
            requirements: runtime.requirements,
            resources: binding.resources(runtime.resources)
        });
        return bound.scenario(runtime.id.scenarios);
    }

    if (graph.kind === 'runtime') {
        return bindRuntime(graph);
    }
    if (graph.kind === 'composed-runtimes') {
        const [ first, ...remaining ] = graph.runtimes;
        if (first === undefined) {
            throw new TypeError('Composed runtimes require a runtime.');
        }
        return runtimeMatrixDefinitionApi.composeRuntimes(
            bindRuntimeWorkload(first, binding),
            ...remaining.map(function bindGraph(runtime) {
                return bindRuntimeWorkload(runtime, binding);
            })
        );
    }
    return runtimeMatrixDefinitionApi.defineRuntimeMatrix({
        name: graph.name,
        variants: Object.fromEntries(
            Object.entries(graph.variants).map(function bindVariant([ key, variant ]) {
                return [ key, bindRuntime(variant.runtime) ];
            })
        )
    });
}
