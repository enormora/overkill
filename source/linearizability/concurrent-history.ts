import { isTestControlError } from '../packages/engine/engine.entry-point.ts';
import type {
    LinearizabilityEvent,
    LinearizabilityProgram,
    LinearizabilityOutcome
} from './linearizability-definition.ts';

type HistoryExecution<Operation, Output, System> = {
    readonly run: (operation: Operation, system: System, signal: AbortSignal) => Output | Promise<Output>;
    readonly system: System;
    readonly signal: AbortSignal;
    readonly controller: AbortController;
    readonly record: (event: LinearizabilityEvent<Operation, Output>) => void;
};

function asynchronousOutput<Output>(value: Output | Promise<Output>): value is Promise<Output> {
    const candidate: unknown = value;
    if (candidate === null) {
        return false;
    }
    return (typeof candidate === 'object' || typeof candidate === 'function') &&
        typeof Reflect.get(candidate, 'then') === 'function';
}

function recordOutcome<Operation, Output, System>(
    context: HistoryExecution<Operation, Output, System>,
    id: string,
    outcome: LinearizabilityOutcome<Output>
): void {
    context.signal.throwIfAborted();
    context.record(Object.freeze({ kind: 'respond', id, outcome: Object.freeze(outcome) }));
}

function recordError<Operation, Output, System>(
    context: HistoryExecution<Operation, Output, System>,
    id: string,
    error: unknown
): void {
    context.signal.throwIfAborted();
    if (isTestControlError(error)) {
        context.controller.abort(error);
        throw error;
    }
    recordOutcome(context, id, { kind: 'threw', error });
}

async function observeAsyncOutput<Operation, Output, System>(
    context: HistoryExecution<Operation, Output, System>,
    id: string,
    output: Promise<Output>
): Promise<void> {
    try {
        recordOutcome(context, id, { kind: 'returned', value: await output });
    } catch (error: unknown) {
        recordError(context, id, error);
    }
}

function observeOutput<Operation, Output, System>(
    context: HistoryExecution<Operation, Output, System>,
    id: string,
    output: Output | Promise<Output>
): Promise<void> | void {
    if (asynchronousOutput(output)) {
        return observeAsyncOutput(context, id, output);
    }
    recordOutcome(context, id, { kind: 'returned', value: output });
    return undefined;
}

function invokeOperation<Operation, Output, System>(
    context: HistoryExecution<Operation, Output, System>,
    id: string,
    operation: Operation
): Promise<void> | void {
    try {
        return observeOutput(context, id, context.run(operation, context.system, context.signal));
    } catch (error: unknown) {
        recordError(context, id, error);
        return undefined;
    }
}

async function executeLane<Operation, Output, System>(
    context: HistoryExecution<Operation, Output, System>,
    operations: readonly Operation[],
    prediction: readonly Operation[],
    laneIndex: number
): Promise<void> {
    const predicted = prediction.values();
    for (const [ index, operation ] of operations.entries()) {
        context.signal.throwIfAborted();
        const observation = predicted.next();
        if (observation.done === true) {
            throw new TypeError('Missing reconstructed operation.');
        }
        const id = `${laneIndex}:${index}`;
        context.record(Object.freeze({ kind: 'invoke', id, operation: observation.value }));
        await invokeOperation(context, id, operation);
    }
}

async function guardedLane<Operation, Output, System>(
    context: HistoryExecution<Operation, Output, System>,
    operations: readonly Operation[],
    prediction: readonly Operation[],
    laneIndex: number
): Promise<void> {
    try {
        await executeLane(context, operations, prediction, laneIndex);
    } catch (error: unknown) {
        if (!context.signal.aborted) {
            context.controller.abort(error);
        }
        throw error;
    }
}

export async function concurrentHistory<Operation, Output, System>(
    run: HistoryExecution<Operation, Output, System>['run'],
    system: System,
    programs: readonly [LinearizabilityProgram<Operation>, LinearizabilityProgram<Operation>],
    parentSignal: AbortSignal
): Promise<readonly LinearizabilityEvent<Operation, Output>[]> {
    const [ execution, prediction ] = programs;
    const controller = new AbortController();
    const history: LinearizabilityEvent<Operation, Output>[] = [];
    const context: HistoryExecution<Operation, Output, System> = {
        run,
        system,
        controller,
        signal: AbortSignal.any([ parentSignal, controller.signal ]),
        record(event) {
            history.push(event);
        }
    };
    await Promise.allSettled(execution.map(async function (operations, index) {
        const lane = prediction[index];
        if (lane === undefined) {
            throw new TypeError('Missing reconstructed lane.');
        }
        return guardedLane(context, operations, lane, index);
    }));
    context.signal.throwIfAborted();
    return Object.freeze(history);
}
