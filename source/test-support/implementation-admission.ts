import { z } from 'zod/v4';
import { createModuleLoading } from '../module-delivery.ts';
import { assertImplementationGraph, deliverImplementationGraph } from '../implementation-graph.ts';
import { defineImplementationReference } from '../implementation-reference.ts';
import {
    createPreparedAssignmentSession,
    type ImplementationAssignmentRequest,
    type ImplementationAssignmentGraph,
    type ImplementationPreparationSession
} from '../implementation-assignment.ts';
import { moduleLoadingRuntime } from './module-loading-runtime.ts';
import {
    memoryImplementationGraph,
    memoryImplementationModule,
    mainImplementationUrl
} from './memory-implementation-graph.ts';

type ImplementationAdmissionFixture = {
    readonly request: ImplementationAssignmentRequest;
    readonly controller: AbortController;
    readonly session: ImplementationPreparationSession;
    readonly graph: ImplementationAssignmentGraph;
    readonly events: readonly string[];
    readonly namespace: unknown;
};
export function implementationAdmission(): ImplementationAdmissionFixture {
    const platform = moduleLoadingRuntime();
    const loading = createModuleLoading(platform.runtime);
    const sources = memoryImplementationGraph([ memoryImplementationModule(mainImplementationUrl, {}) ]);
    const controller = new AbortController();
    const events: string[] = [];
    return {
        controller,
        events,
        namespace: platform.namespace,
        session: createPreparedAssignmentSession(sources.preparation),
        request: {
            context: { projectRoot: '/project' },
            signal: controller.signal,
            participants: [ {
                key: 'case:body',
                role: 'body',
                scope: null,
                binding: null,
                reference: defineImplementationReference({
                    module: { moduleUrl: mainImplementationUrl, exportName: 'value' },
                    realm: 'host',
                    version: '1',
                    input: null,
                    dynamicModules: [],
                    parseInput(value) {
                        return z.null().parse(value);
                    }
                }),
                bind(namespace) {
                    if (namespace !== platform.namespace) {
                        throw new Error('Wrong implementation namespace.');
                    }
                    events.push('bind');
                    return {
                        async run(operation) {
                            events.push('activate');
                            return await operation();
                        }
                    };
                }
            } ]
        },
        graph: {
            async verifyImplementationGraph(graph, facts) {
                events.push('verify');
                assertImplementationGraph(graph, await sources.preparation.prepare(facts));
            },
            async withImplementationGraph(graph, operation) {
                events.push('deliver');
                return await deliverImplementationGraph(graph, operation, loading.withModuleDelivery);
            }
        }
    };
}
