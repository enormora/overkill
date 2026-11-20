import { setImmediate as scheduleCancellation, clearImmediate as cancelScheduledCancellation } from 'node:timers';
import { type TestNode, suite, test } from '@overkill-dev/test';

import {
    checkLinearizability,
    type LinearizabilityEvent,
    type LinearizabilityModel
} from '../../../packages/linearizability/linearizability.entry-point.ts';

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
const read: Event = { kind: 'invoke', id: 'read', operation: { kind: 'read' } };
function response(id: string, value: number): Event {
    return { kind: 'respond', id, outcome: { kind: 'returned', value } };
}

export const testNode: TestNode = suite('linearizability histories', [
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
    })
]);
