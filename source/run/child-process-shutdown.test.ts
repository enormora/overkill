import { type TestNode, suite, test } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { observeChildShutdown, startChildShutdown } from './child-process-shutdown.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';

type ChildFixture = {
    readonly child: SupervisedChildProcess;
    readonly signals: readonly string[];
    readonly closedTransports: () => number;
    readonly emit: (event: 'close' | 'disconnect' | 'exit') => void;
};
function childFixture(): ChildFixture {
    const events = new Map<string, (() => void)[]>();
    const signals: string[] = [];
    let closedTransports = 0;
    const child: SupervisedChildProcess = {
        closeTransport() {
            closedTransports += 1;
        },
        exitCode: null,
        signalCode: null,
        pid: 1,
        kill(signal) {
            signals.push(signal);
        },
        on(...registration) {
            const [ event, listener ] = registration;
            if (event !== 'error' && event !== 'message') {
                events.set(event, [ ...events.get(event) ?? [], listener ]);
            }
        },
        send() {
            return undefined;
        },
        stderr: null,
        stdout: null
    };
    return {
        child,
        signals,
        closedTransports() {
            return closedTransports;
        },
        emit(event: 'close' | 'disconnect' | 'exit') {
            const listeners = events.get(event) ?? [];
            for (const listener of listeners) {
                listener();
            }
        }
    };
}

type ShutdownFixture = {
    readonly clock: ReturnType<typeof createDeterministicClock>;
    readonly child: ChildFixture;
    readonly counts: { readonly failures: number; readonly finishes: number; };
    readonly recordTimeout: () => void;
    readonly recordFinished: () => void;
};
function shutdownFixture(): ShutdownFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const child = childFixture();
    const counts = { failures: 0, finishes: 0 };
    observeChildShutdown(child.child, clock, function reportTimeout() {
        counts.failures += 1;
    }, function reportFinished() {
        counts.finishes += 1;
    });
    return {
        clock,
        child,
        counts,
        recordTimeout() {
            counts.failures += 1;
        },
        recordFinished() {
            counts.finishes += 1;
        }
    };
}
export const testNode: TestNode = suite('bounded child shutdown', [
    test('termination waiting stays bounded when the child never closes', function (scope) {
        const fixture = shutdownFixture();
        startChildShutdown(fixture.child.child);
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.deepEqual({ ...fixture.counts }, { failures: 1, finishes: 0 });
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.deepEqual({ ...fixture.counts }, { failures: 1, finishes: 1 });
        fixture.child.emit('close');
        scope.assert.equal(fixture.counts.finishes, 1);
        return scope.assert.collect();
    }),
    test('failure to signal a lingering child still closes transport and settles', function (scope) {
        const fixture = shutdownFixture();
        const child = {
            ...fixture.child.child,
            kill(): void {
                throw new Error('cannot signal');
            }
        };
        observeChildShutdown(child, fixture.clock, fixture.recordTimeout, fixture.recordFinished);
        startChildShutdown(child);
        fixture.clock.advanceByMilliseconds(1000);
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.deepEqual(fixture.counts, { failures: 1, finishes: 1 });
        scope.assert.equal(fixture.child.closedTransports(), 1);
        return scope.assert.collect();
    }),

    test('completion starts a non-resetting deadline and kills a child that never exits', function (scope) {
        const fixture = shutdownFixture();
        startChildShutdown(fixture.child.child);
        fixture.clock.advanceByMilliseconds(500);
        startChildShutdown(fixture.child.child);
        fixture.clock.advanceByMilliseconds(500);
        scope.assert.deepEqual({
            ...fixture.counts,
            signals: fixture.child.signals,
            closedTransports: fixture.child.closedTransports()
        }, {
            failures: 1,
            finishes: 0,
            signals: [ 'SIGKILL' ],
            closedTransports: 1
        });
        fixture.child.emit('close');
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.equal(fixture.counts.finishes, 1);
        return scope.assert.collect();
    }),
    test('normal closure cancels the deadline without killing or recording a failure', function (scope) {
        const fixture = shutdownFixture();
        fixture.child.emit('exit');
        fixture.child.emit('close');
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.deepEqual({
            ...fixture.counts,
            signals: fixture.child.signals,
            closedTransports: fixture.child.closedTransports()
        }, {
            failures: 0,
            finishes: 1,
            signals: [],
            closedTransports: 0
        });
        return scope.assert.collect();
    }),
    test('transport cleanup failure still settles a timed out child', function (scope) {
        const fixture = shutdownFixture();
        const child = {
            ...fixture.child.child,
            closeTransport(): void {
                throw new Error('already closed');
            }
        };
        observeChildShutdown(child, fixture.clock, function reportTimeout() {
            fixture.recordTimeout();
        }, function reportFinished() {
            fixture.recordFinished();
        });
        startChildShutdown(child);
        fixture.clock.advanceByMilliseconds(1000);
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.deepEqual(fixture.counts, { failures: 1, finishes: 1 });
        return scope.assert.collect();
    })
]);
