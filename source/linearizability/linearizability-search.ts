import type { LinearizabilityModel, LinearizabilityTransition } from './linearizability-definition.ts';
import type { RecordedOperation } from './linearizability-history.ts';
import { validateLinearizabilityTransition } from './linearizability-validation.ts';

type SearchNode<State, Operation, Output> = {
    readonly state: State;
    readonly order: readonly string[];
    readonly remaining: readonly RecordedOperation<Operation, Output>[];
};

function nextStates<State>(transition: LinearizabilityTransition<State>): readonly State[] {
    validateLinearizabilityTransition(transition);
    if (transition.kind === 'disabled') {
        return [];
    }
    return transition.kind === 'enabled' ? [ transition.state ] : transition.states;
}

async function* successors<State, Operation, Output>(
    node: SearchNode<State, Operation, Output>,
    model: LinearizabilityModel<State, Operation, Output>,
    charge: () => Promise<void>
): AsyncGenerator<SearchNode<State, Operation, Output>> {
    for (const operation of node.remaining) {
        await charge();
        const blocked = node.remaining.some(function precedes(other) {
            return other.response < operation.invocation;
        });
        if (!blocked) {
            await charge();
            const states = nextStates(model.transition(node.state, operation.observation));
            for (const state of states) {
                await charge();
                yield {
                    state,
                    order: [ ...node.order, operation.id ],
                    remaining: node.remaining.filter(function unselected(other) {
                        return other !== operation;
                    })
                };
            }
        }
    }
}

export async function* linearizabilitySearch<State, Operation, Output>(
    root: SearchNode<State, Operation, Output>,
    model: LinearizabilityModel<State, Operation, Output>,
    charge: () => Promise<void>
): AsyncGenerator<SearchNode<State, Operation, Output>> {
    const stack = [ successors(root, model, charge) ];
    yield root;
    while (stack.length > 0) {
        const next = await stack.at(-1)?.next();
        if (next === undefined || next.done === true) {
            stack.pop();
        } else {
            yield next.value;
            stack.push(successors(next.value, model, charge));
        }
    }
}
