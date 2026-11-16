import { isDeepStrictEqual } from 'node:util';
import { withRunnerInfrastructure } from './execution-ownership.ts';
import { preloadImplementation } from './implementation-preload.ts';
import {
    implementationFacts,
    type ImplementationFacts,
    type ImplementationInputContext
} from './implementation-reference.ts';
import {
    withImplementationActivations,
    type ImplementationActivation,
    type ImplementationParticipant
} from './implementation-participant.ts';
import type { ImplementationGraph } from './implementation-graph.ts';

export type ImplementationAssignment = Pick<ImplementationParticipant, 'binding' | 'key' | 'role' | 'scope'> & {
    readonly facts: ImplementationFacts;
};
export type PreparedImplementationAssignments = {
    readonly assignments: readonly ImplementationAssignment[];
    readonly graph: ImplementationGraph;
};
export type ImplementationAssignmentRequest = {
    readonly participants: readonly ImplementationParticipant[];
    readonly context: ImplementationInputContext;
    readonly signal: AbortSignal;
};

export function assignmentFacts(request: ImplementationAssignmentRequest): readonly ImplementationAssignment[] {
    const keys = new Set<string>();
    return request.participants.map(function assignment(participant) {
        if (keys.has(participant.key)) {
            throw new TypeError(`Duplicate implementation ownership: ${participant.key}`);
        }
        keys.add(participant.key);
        return Object.freeze({
            key: participant.key,
            role: participant.role,
            scope: participant.scope,
            binding: participant.binding,
            facts: implementationFacts(participant.reference, request.context)
        });
    });
}

export async function prepareImplementationAssignments(
    request: ImplementationAssignmentRequest
): Promise<PreparedImplementationAssignments> {
    request.signal.throwIfAborted();
    const assignments = assignmentFacts(request);
    const { prepareImplementationGraph } = await import('./implementation-graph.ts');
    const graph = await prepareImplementationGraph(assignments.map(function facts(assignment) {
        return assignment.facts;
    }));
    request.signal.throwIfAborted();
    return Object.freeze({ assignments: Object.freeze(assignments), graph });
}

export async function withImplementationAdmission<Value>(
    request: ImplementationAssignmentRequest & { readonly prepared: PreparedImplementationAssignments; },
    operation: (activations: readonly ImplementationActivation[]) => Promise<Value>
): Promise<Value> {
    request.signal.throwIfAborted();
    const assignments = assignmentFacts(request);
    const expected = request.prepared.assignments.filter(function assigned(assignment) {
        return assignments.some(function sameKey(current) {
            return current.key === assignment.key;
        });
    });
    if (
        assignments.length !== expected.length || !isDeepStrictEqual(
            new Map(assignments.map(function pair(entry) {
                return [ entry.key, entry ];
            })),
            new Map(expected.map(function pair(entry) {
                return [ entry.key, entry ];
            }))
        )
    ) {
        throw new TypeError('Implementation assignments changed; prepare and collect a new run.');
    }
    const { verifyImplementationGraph, withImplementationGraph } = await withRunnerInfrastructure(
        async function graph() {
            return await import('./implementation-graph.ts');
        }
    );
    await withRunnerInfrastructure(async function verify() {
        await verifyImplementationGraph(
            request.prepared.graph,
            request.prepared.assignments.map(function facts(assignment) {
                return assignment.facts;
            })
        );
    });
    return await withImplementationGraph(request.prepared.graph, async function preload(load) {
        const activations: ImplementationActivation[] = [];
        for (const [ index, participant ] of request.participants.entries()) {
            const assignment = assignments[index];
            if (assignment === undefined) {
                throw new TypeError('Implementation assignment is missing.');
            }
            const loaded = await withRunnerInfrastructure(async function preloadEntry() {
                return await preloadImplementation(async function loadEntry() {
                    return await load(assignment.facts.module.moduleUrl);
                }, request.signal);
            });
            request.signal.throwIfAborted();
            activations.push(participant.bind(loaded.namespace, assignment.facts, request.context));
        }
        return await operation(activations);
    });
}

export async function withPreparedImplementationAssignments<Value>(
    request: ImplementationAssignmentRequest & { readonly prepared: PreparedImplementationAssignments; },
    operation: () => Promise<Value>
): Promise<Value> {
    return await withImplementationAdmission(request, async function activate(activations) {
        return await withImplementationActivations(activations, operation);
    });
}

export type ImplementationPreparationSession = {
    readonly prepare: (request: ImplementationAssignmentRequest) => Promise<PreparedImplementationAssignments>;
};
export async function createImplementationPreparationSession(): Promise<ImplementationPreparationSession> {
    const { createImplementationGraphPreparation } = await withRunnerInfrastructure(async function graph() {
        return await import('./implementation-graph.ts');
    });
    const preparation = createImplementationGraphPreparation();
    return {
        async prepare(request) {
            request.signal.throwIfAborted();
            const assignments = assignmentFacts(request);
            const graph = await withRunnerInfrastructure(async function prepareGraph() {
                return await preparation.prepare(assignments.map(function facts(assignment) {
                    return assignment.facts;
                }));
            });
            request.signal.throwIfAborted();
            return { assignments, graph };
        }
    };
}
