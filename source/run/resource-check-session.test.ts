import { table, suite, test, testDouble } from '@overkill-dev/test';

import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';

import { createDefaultWorkId } from '../engine/identity.ts';
import { createStoredValue } from '../stored-value.ts';
import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import type { ResourceCheckFrame } from './resource-check-channel.ts';
import {
    createResourceCheckSession,
    type ResourceCheckSession,
    type ResourceCheckConnection
} from './resource-check-session.ts';

const work = createDefaultWorkId({ file: null, suite: [], title: 'consumer', params: null });
const otherWork = createDefaultWorkId({ file: null, suite: [], title: 'other consumer', params: null });
const interval = { kind: 'attempt', work, attempt: { index: 0 } } as const;
const owner = { run: 'session', id: 'owner', scope: 'per-run' } as const;
const snapshot: ResourceCheckSnapshot = {
    owner,
    resource: 'service',
    revision: 1,
    interval,
    passing: 1,
    failures: [],
    errors: [],
    status: { kind: 'complete' }
};
type Scenario = {
    readonly clock: DeterministicClock;
    readonly session: ResourceCheckSession;
    readonly connection: ResourceCheckConnection;
    readonly sent: readonly ResourceCheckFrame[];
};
function scenario(): Scenario {
    const destroyed = createStoredValue(false);
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const connection: ResourceCheckConnection = {
        get destroyed() {
            return destroyed.read();
        },
        destroy() {
            destroyed.write(true);
        },
        ref() {
            return undefined;
        },
        unref() {
            return undefined;
        }
    };
    const sent: ResourceCheckFrame[] = [];
    const session = createResourceCheckSession(owner.run, connection, clock);
    session.connect(function send(frame) {
        sent.push(frame);
    });
    return { session, clock, connection, sent };
}
export const testNode = suite('resource observation session policy', [
    test('matches acknowledgements to pending requests', async function (scope) {
        const fixture = scenario();
        const pending = fixture.session.exchange({ kind: 'flush', request: 'request' });
        await fixture.session.receive({ kind: 'result', request: 'unrelated', snapshots: [], errors: [] });
        const result = { kind: 'result', request: 'request', snapshots: [ snapshot ], errors: [] } as const;
        await fixture.session.receive(result);
        scope.assert.equal(await pending, result);
        scope.assert.deepEqual(fixture.sent, [ { kind: 'flush', request: 'request' } ]);
        return scope.assert.collect();
    }),
    test('bounds missing acknowledgements with the supplied clock', async function (scope) {
        const fixture = scenario();
        const pending = fixture.session.exchange({ kind: 'flush', request: 'request' });
        const rejection = scope.assert.rejects(async function () {
            return await pending;
        }, { message: /acknowledgement timed out/u });
        fixture.clock.advanceByMilliseconds(2500);
        await rejection;
        const retry = fixture.session.exchange({ kind: 'flush', request: 'retry' });
        await fixture.session.receive({ kind: 'result', request: 'retry', snapshots: [], errors: [] });
        const retried = await retry;
        scope.assert.deepEqual(retried.errors, []);
        return scope.assert.collect();
    }),
    test('rejects requests on destroyed or disconnected channels', async function (scope) {
        const fixture = scenario();
        fixture.connection.destroy();
        await scope.assert.rejects(async function () {
            return fixture.session.exchange({ kind: 'flush', request: 'closed' });
        }, { message: /channel closed/u });
        const disconnected = createResourceCheckSession(owner.run, scenario().connection, fixture.clock);
        await scope.assert.rejects(async function () {
            return disconnected.exchange({ kind: 'flush', request: 'disconnected' });
        }, { message: /not connected/u });
        return scope.assert.collect();
    }),
    test('cancels active consumers and pending requests when disconnected', async function (scope) {
        const fixture = scenario();
        const causes: unknown[] = [];
        const release = fixture.session.delivery.active(interval, function cancel(cause) {
            causes.push(cause);
        });
        const pending = fixture.session.exchange({ kind: 'flush', request: 'lost' });
        const rejection = scope.assert.rejects(async function () {
            return pending;
        }, { message: /channel closed/u });
        fixture.session.disconnected();
        await rejection;
        release();
        scope.assert.true(
            causes[0] instanceof Error && causes[0].message === 'Required resource observation was lost.'
        );
        return scope.assert.collect();
    }),
    test('cancels matching attempts and lifetime consumers only', async function (scope) {
        const fixture = scenario();
        const causes: unknown[] = [];
        const release = fixture.session.delivery.active(interval, function cancel(cause) {
            causes.push(cause);
        });
        await Promise.all([
            fixture.session.receive({ kind: 'cancel', work: otherWork, interval, cause: 'unrelated' }),
            fixture.session.receive({
                kind: 'cancel',
                work,
                interval: { ...interval, attempt: { index: 1 } },
                cause: 'other attempt'
            }),
            fixture.session.receive({ kind: 'cancel', work, interval, cause: 'attempt' })
        ]);
        await fixture.session.receive({ kind: 'cancel', work, interval: { kind: 'lifetime' }, cause: 'lifetime' });
        release();
        await fixture.session.receive({ kind: 'cancel', work, interval, cause: 'released' });
        scope.assert.deepEqual(causes, [ 'attempt', 'lifetime' ]);
        return scope.assert.collect();
    }),
    test('registers owners and acknowledges successful finalization', async function (scope) {
        const fixture = scenario();
        const finalized: unknown[] = [];
        fixture.session.delivery.register(owner, 'service', [ work ], async function finish(value) {
            finalized.push(value);
        });
        await fixture.session.receive({ kind: 'finalize-owner', request: 'finish', owner, interval });
        scope.assert.deepEqual(finalized, [ interval ]);
        scope.assert.deepEqual(fixture.sent, [ { kind: 'register', owner, resource: 'service', consumers: [ work ] }, {
            kind: 'finalized',
            request: 'finish',
            errors: []
        } ]);
        return scope.assert.collect();
    }),
    test('reports unavailable owners instead of acknowledging success', async function (scope) {
        const fixture = scenario();
        await fixture.session.receive({ kind: 'finalize-owner', request: 'finish', owner, interval });
        scope.assert.deepEqual(fixture.sent, [ {
            kind: 'finalized',
            request: 'finish',
            errors: [ 'Resource owner is unavailable.' ]
        } ]);
        return scope.assert.collect();
    }),
    table({
        title: 'retains owner finalization failure',
        cases: [ new Error('finalization failed'), 42 ].map(function (failure, index) {
            return { failure, index };
        }),
        caseTitle({ failure }) {
            return failure instanceof Error ? 'exception' : 'numeric rejection';
        },
        async test(scope) {
            const { failure, index } = scope.parameters;

            const fixture = scenario();
            fixture.session.delivery.register(owner, 'service', [ work ], async function finish() {
                testDouble.throws<() => void>(failure)();
            });
            await fixture.session.receive({ kind: 'finalize-owner', request: 'finish', owner, interval });
            scope.assert.deepEqual<unknown, unknown>(fixture.sent[1], {
                kind: 'finalized',
                request: 'finish',
                errors: [ index === 0 ? 'finalization failed' : '42' ]
            });
            return scope.assert.collect();
        }
    }),
    test(
        'destroys the channel if finalization acknowledgement cannot be sent',
        async function (scope) {
            const fixture = scenario();
            fixture.session.connect(function send() {
                throw new Error('send failed');
            });
            await fixture.session.receive({ kind: 'finalize-owner', request: 'finish', owner, interval });
            scope.assert.true(fixture.connection.destroyed);
            return scope.assert.collect();
        }
    ),
    test('publishes portable checkpoints and serialized stop causes', function (scope) {
        const fixture = scenario();
        fixture.session.delivery.checkpoint(snapshot);
        fixture.session.delivery.stop(owner, interval, 'stop');
        scope.assert.deepEqual(fixture.sent, [ { kind: 'checkpoint', snapshot }, {
            kind: 'stop',
            owner,
            interval,
            cause: { kind: 'string', value: 'stop', truncation: null }
        } ]);
        return scope.assert.collect();
    }),
    test('destroys the channel when checkpoint delivery fails', function (scope) {
        const fixture = scenario();
        fixture.session.connect(function send() {
            throw new Error('send failed');
        });
        fixture.session.delivery.checkpoint(snapshot);
        scope.assert.true(fixture.connection.destroyed);
        return scope.assert.collect();
    }),
    test('ignores server-inapplicable frames', async function (scope) {
        const fixture = scenario();
        await fixture.session.receive({ kind: 'flush', request: 'ignored' });
        scope.assert.deepEqual(fixture.sent, []);
        scope.assert.false(fixture.connection.destroyed);
        return scope.assert.collect();
    }),
    test('flush waits for its acknowledgement', async function (scope) {
        const fixture = scenario();
        const pending = fixture.session.delivery.flush();
        const frame = fixture.sent[0];
        if (frame?.kind !== 'flush') {
            throw new Error('Expected a flush request.');
        }
        await fixture.session.receive({ kind: 'result', request: frame.request, snapshots: [], errors: [] });
        await pending;
        scope.assert.equal(fixture.sent.length, 1);
        return scope.assert.collect();
    })
]);
