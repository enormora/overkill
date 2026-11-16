import { isDeepStrictEqual } from 'node:util';
import { withRunnerInfrastructure } from './execution-ownership.ts';
import { preloadImplementation } from './implementation-preload.ts';
import {
    implementationFacts,
    readImplementationExport,
    type ImplementationFacts,
    type ImplementationInputContext,
    type ImplementationReference
} from './implementation-reference.ts';
import { snapshotPortableValue, type PortableValue } from './portable-value.ts';
import type { ImplementationGraph } from './implementation-graph.ts';

export type PreparedImplementation = {
    readonly facts: ImplementationFacts;
    readonly graph: ImplementationGraph;
};

export type ImplementationPreparation<Input extends PortableValue> = {
    readonly reference: ImplementationReference<Input>;
    readonly context: ImplementationInputContext;
    readonly signal: AbortSignal;
};

export async function prepareImplementation<Input extends PortableValue>(
    request: ImplementationPreparation<Input>
): Promise<PreparedImplementation> {
    request.signal.throwIfAborted();
    const facts = implementationFacts(request.reference, request.context);
    const { prepareImplementationGraph } = await import('./implementation-graph.ts');
    const graph = await prepareImplementationGraph([ facts ]);
    request.signal.throwIfAborted();
    return Object.freeze({ facts, graph });
}

export type ImplementationAdmission<Input extends PortableValue, Implementation> = ImplementationPreparation<Input> & {
    readonly prepared: PreparedImplementation;
    readonly parseImplementation: (value: unknown) => Implementation;
};

export async function withPreparedImplementation<Input extends PortableValue, Implementation, Result>(
    request: ImplementationAdmission<Input, Implementation>,
    use: (implementation: Implementation, input: Input) => Promise<Result>
): Promise<Result> {
    request.signal.throwIfAborted();
    const input = snapshotPortableValue(request.reference.parseInput(request.reference.input, request.context));
    const facts = implementationFacts(request.reference, request.context);
    if (!isDeepStrictEqual(facts, request.prepared.facts) || !isDeepStrictEqual(input, facts.input)) {
        throw new TypeError('Implementation inputs changed; prepare and collect a new run.');
    }
    const { verifyImplementationGraph, withImplementationGraph } = await withRunnerInfrastructure(
        async function graph() {
            return await import('./implementation-graph.ts');
        }
    );
    await verifyImplementationGraph(request.prepared.graph, [ facts ]);
    request.signal.throwIfAborted();
    return await withImplementationGraph(request.prepared.graph, async function admit(load) {
        const loaded = await withRunnerInfrastructure(async function preload() {
            return await preloadImplementation(async function loadEntry() {
                return await load(facts.module.moduleUrl);
            }, request.signal);
        });
        const implementation = readImplementationExport(loaded.namespace, facts, request.parseImplementation);
        request.signal.throwIfAborted();
        return await use(implementation, input);
    });
}
