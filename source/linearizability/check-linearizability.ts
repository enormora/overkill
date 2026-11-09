import type { LinearizabilityRequest, LinearizabilityResult } from './linearizability-definition.ts';
import { linearizabilityHistory, type RecordedOperation } from './linearizability-history.ts';
import { linearizabilityBudget, type SearchBudget } from './linearizability-budget.ts';
import { linearizabilitySearch } from './linearizability-search.ts';
import { validateLinearizabilityRequest } from './linearizability-validation.ts';

async function evaluateHistory<State, Operation, Output>(
    request: LinearizabilityRequest<State, Operation, Output>,
    budget: SearchBudget,
    history: readonly RecordedOperation<Operation, Output>[]
): Promise<LinearizabilityResult> {
    const root = { state: request.model.initial(), order: [], remaining: history };
    let prefix: readonly string[] = [];
    async function search(): Promise<LinearizabilityResult> {
        for await (const node of linearizabilitySearch(root, request.model, budget.charge)) {
            request.signal.throwIfAborted();
            if (node.order.length > prefix.length) {
                prefix = node.order;
            }
            if (
                node.remaining.every(function pending(operation) {
                    return operation.response === Number.POSITIVE_INFINITY;
                })
            ) {
                return Object.freeze({ kind: 'linearizable', order: Object.freeze(node.order), work: budget.work() });
            }
        }
        request.signal.throwIfAborted();
        return Object.freeze({ kind: 'not-linearizable', prefix: Object.freeze(prefix), work: budget.work() });
    }
    try {
        return await search();
    } catch (error) {
        request.signal.throwIfAborted();
        if (!budget.exhausted(error)) {
            throw error;
        }
        return Object.freeze({
            kind: 'inconclusive',
            reason: 'max-work',
            prefix: Object.freeze(prefix),
            work: budget.work()
        });
    }
}

export async function checkLinearizability<State, Operation, Output>(
    request: LinearizabilityRequest<State, Operation, Output>
): Promise<LinearizabilityResult> {
    validateLinearizabilityRequest(request);
    const history = linearizabilityHistory(request.history);
    request.signal.throwIfAborted();
    const snapshot = {
        ...request,
        history: request.history,
        model: Object.freeze({ initial: request.model.initial, transition: request.model.transition })
    };
    const budget = linearizabilityBudget(request.maxWork, request.signal);
    return evaluateHistory(snapshot, budget, history);
}
