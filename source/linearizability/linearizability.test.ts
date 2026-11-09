import { setImmediate as scheduleCancellation, clearImmediate as cancelScheduledCancellation } from 'node:timers';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    checkLinearizability,
    type LinearizabilityEvent,
    type LinearizabilityResult,
    type LinearizabilityModel
} from '../packages/linearizability/linearizability.entry-point.ts';

type Operation = { readonly kind: 'read'; } | { readonly kind: 'write'; readonly value: number; };
type Event = LinearizabilityEvent<Operation, number>;
const model: LinearizabilityModel<number, Operation, number> = {
    initial() {
        return 0;
    },
    transition(state, { operation, outcome }) {
        if (operation.kind === 'write') {
            return { kind: 'enabled', state: operation.value };
        }
        return outcome.kind === 'pending' || outcome.kind === 'returned' && outcome.value === state
            ? { kind: 'enabled', state }
            : { kind: 'disabled' };
    }
};
function freshSignal(): AbortSignal {
    const controller = new AbortController();
    return controller.signal;
}
async function check(history: readonly Event[], maxWork: number): Promise<LinearizabilityResult> {
    return checkLinearizability({ history, model, maxWork, signal: freshSignal() });
}
const write: Event = { kind: 'invoke', id: 'write', operation: { kind: 'write', value: 1 } };
const read: Event = { kind: 'invoke', id: 'read', operation: { kind: 'read' } };
function response(id: string, value: number): Event {
    return { kind: 'respond', id, outcome: { kind: 'returned', value } };
}

function permutations(values: readonly number[]): number[][] {
    if (values.length === 0) {
        return [ [] ];
    }
    return values.flatMap(function first(value) {
        return permutations(values.filter(function other(candidate) {
            return candidate !== value;
        }))
            .map(function prepend(suffix) {
                return [ value, ...suffix ];
            });
    });
}
function recordedEvents(events: readonly number[], pending: boolean, value: number): Event[] {
    const catalog = [ write, read, response('write', 1), response('read', value) ];
    return events
        .filter(function retained(index) {
            return !pending || index !== 2;
        })
        .flatMap(function event(index) {
            const entry = catalog[index];
            return entry === undefined ? [] : [ entry ];
        });
}
function respectsPrecedence(order: readonly string[], history: readonly Event[]): boolean {
    return history.every(function earlier(event, position) {
        if (event.kind !== 'respond' || !order.includes(event.id)) {
            return true;
        }
        return history.slice(position + 1).every(function later(other) {
            return other.kind !== 'invoke' || !order.includes(other.id) ||
                order.indexOf(event.id) < order.indexOf(other.id);
        });
    });
}
function oracle(history: readonly Event[], pending: boolean, value: number): boolean {
    const candidates = pending
        ? [ [ 'read' ], [ 'write', 'read' ], [ 'read', 'write' ] ]
        : [ [ 'write', 'read' ], [ 'read', 'write' ] ];
    return candidates.some(function explains(order) {
        const readState = order.slice(0, order.indexOf('read')).includes('write') ? 1 : 0;
        return value === readState && respectsPrecedence(order, history);
    });
}

export const testNode = suite('linearizability histories', [
    test('matches an independent subset and permutation oracle', async function (scope) {
        const schedules = permutations([ 0, 1, 2, 3 ]).filter(function valid(events) {
            return events.indexOf(2) > events.indexOf(0) && events.indexOf(3) > events.indexOf(1);
        });
        for (const events of schedules) {
            for (const pending of [ true, false ]) {
                for (const value of [ 0, 1, 2 ]) {
                    const history = recordedEvents(events, pending, value);
                    const result = await check(history, 1000);
                    scope.assert.equal(
                        result.kind,
                        oracle(history, pending, value) ? 'linearizable' : 'not-linearizable'
                    );
                }
            }
        }
        return scope.assert.collect();
    }),
    test('observes cancellation during yielded search', async function (scope) {
        const controller = new AbortController();
        const history: Event[] = Array.from({ length: 8 }, function (_value, index): Event {
            return { kind: 'invoke', id: String(index), operation: { kind: 'write', value: 1 } };
        });
        history.push(read, response('read', 9));
        const cancellation = new Error('cancel search');
        const handle = scheduleCancellation(function cancel() {
            controller.abort(cancellation);
        });
        try {
            await scope.assert.rejects(async function () {
                await checkLinearizability({ history, model, maxWork: 100_000, signal: controller.signal });
            }, { message: 'cancel search' });
        } finally {
            cancelScheduledCancellation(handle);
        }
        return scope.assert.collect();
    }),
    test('enforces real-time precedence and backtracks overlapping operations', async function (scope) {
        const stale = await check([ write, response('write', 1), read, response('read', 0) ], 100);
        scope.assert.equal(stale.kind, 'not-linearizable');
        const overlapping = await check([ write, read, response('write', 1), response('read', 0) ], 100);
        scope.assert.equal(overlapping.kind, 'linearizable');
        if (overlapping.kind === 'linearizable') {
            scope.assert.deepEqual(overlapping.order, [ 'read', 'write' ]);
        }
        return scope.assert.collect();
    }),
    test('includes necessary pending writes and omits irrelevant pending calls', async function (scope) {
        const included = await check([ write, read, response('read', 1) ], 100);
        scope.assert.equal(included.kind, 'linearizable');
        if (included.kind === 'linearizable') {
            scope.assert.deepEqual(included.order, [ 'write', 'read' ]);
        }
        scope.assert.deepEqual(await check([ write ], 1), { kind: 'linearizable', order: [], work: 0 });
        scope.assert.deepEqual(await check([], 1), { kind: 'linearizable', order: [], work: 0 });
        return scope.assert.collect();
    }),
    test('backtracks alternative pending effects', async function (scope) {
        const result = await checkLinearizability({
            history: [ write, read, response('read', 2) ],
            maxWork: 100,
            signal: freshSignal(),
            model: {
                ...model,
                transition(state, observation) {
                    return observation.outcome.kind === 'pending'
                        ? { kind: 'alternatives', states: [ 1, 2 ] }
                        : model.transition(state, observation);
                }
            }
        });
        scope.assert.equal(result.kind, 'linearizable');
        return scope.assert.collect();
    }),
    test('distinguishes budget exhaustion and exact completion', async function (scope) {
        const history = [ read, response('read', 0) ];
        const exhausted = await check(history, 2);
        scope.assert.deepEqual(exhausted, { kind: 'inconclusive', reason: 'max-work', prefix: [], work: 2 });
        scope.assert.deepEqual(await check(history, 3), { kind: 'linearizable', order: [ 'read' ], work: 3 });
        scope.assert.deepEqual(await check([ read, response('read', 9) ], 2), {
            kind: 'not-linearizable',
            prefix: [],
            work: 2
        });
        return scope.assert.collect();
    }),
    test('rejects invalid histories before model execution', async function (scope) {
        for (
            const history of [ [ write, write ], [ response('absent', 0) ], [
                write,
                response('write', 0),
                response('write', 0)
            ] ]
        ) {
            let called = false;
            await scope.assert.rejects(async function () {
                await checkLinearizability({
                    history,
                    maxWork: 100,
                    signal: freshSignal(),
                    model: {
                        ...model,
                        initial() {
                            called = true;
                            return 0;
                        }
                    }
                });
            }, { type: TypeError });
            scope.assert.equal(called, false);
        }
        for (const maxWork of [ 0, -1, Number.POSITIVE_INFINITY, 1.5 ]) {
            await scope.assert.rejects(async function () {
                await check([], maxWork);
            }, { type: TypeError });
        }
        return scope.assert.collect();
    }),
    test('rejects malformed JavaScript events and transitions', async function (scope) {
        const missingOutcomeValue = [
            { kind: 'invoke', id: 'one', operation: 0 },
            { kind: 'respond', id: 'one', outcome: { kind: 'returned' } }
        ];
        const invalidHistories = [
            null,
            [ {} ],
            [ { kind: 'invoke', id: ' ', operation: 0 } ],
            [ { kind: 'invoke', id: 'one' } ],
            missingOutcomeValue
        ];
        for (const history of invalidHistories) {
            await scope.assert.rejects(async function () {
                await Reflect.apply(checkLinearizability, undefined, [ {
                    history,
                    model,
                    maxWork: 100,
                    signal: freshSignal()
                } ]);
            }, { type: TypeError });
        }
        const sparseStates = [ 0, 1 ];
        Reflect.deleteProperty(sparseStates, '0');
        const invalidTransitions = [
            null,
            {},
            { kind: 'enabled' },
            { kind: 'alternatives', states: [ 0 ] },
            { kind: 'alternatives', states: sparseStates }
        ];
        for (const transition of invalidTransitions) {
            await scope.assert.rejects(async function () {
                await Reflect.apply(checkLinearizability, undefined, [ {
                    history: [ read, response('read', 0) ],
                    model: {
                        initial() {
                            return 0;
                        },
                        transition() {
                            return transition;
                        }
                    },
                    maxWork: 100,
                    signal: freshSignal()
                } ]);
            }, { type: TypeError });
        }
        return scope.assert.collect();
    }),
    test('preserves undefined returns, throws, callback errors and cancellation', async function (scope) {
        for (
            const outcome of [ { kind: 'returned', value: undefined }, { kind: 'threw', error: 'expected' } ] as const
        ) {
            const result = await checkLinearizability({
                history: [ { kind: 'invoke', id: 'one', operation: 0 }, { kind: 'respond', id: 'one', outcome } ],
                model: {
                    initial() {
                        return undefined;
                    },
                    transition(state, observation) {
                        scope.assert.deepEqual(observation.outcome, outcome);
                        return observation.outcome.kind === outcome.kind
                            ? { kind: 'enabled', state }
                            : { kind: 'disabled' };
                    }
                },
                maxWork: 10,
                signal: freshSignal()
            });
            scope.assert.equal(result.kind, 'linearizable');
        }
        const failure = new Error('model failed');
        await scope.assert.rejects(async function () {
            await checkLinearizability({
                history: [],
                maxWork: 10,
                signal: freshSignal(),
                model: {
                    ...model,
                    initial() {
                        throw failure;
                    }
                }
            });
        }, { message: 'model failed' });
        const controller = new AbortController();
        controller.abort(failure);
        await scope.assert.rejects(async function () {
            await checkLinearizability({ history: [], model, maxWork: 10, signal: controller.signal });
        }, { message: 'model failed' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
