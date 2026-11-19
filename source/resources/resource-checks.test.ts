import { fileURLToPath } from 'node:url';
import { suite, test } from '@overkill-dev/test';
import { createClock, createDeterministicClock } from '@enormora/clock';

import { defineImplementationReference } from '../implementation-reference.ts';

import { superviseResourceObservation } from './resource-check-supervision.ts';
import { defineResourceCheckObserverReference } from './resource-check-reference.ts';
import { defineResource } from './resources.ts';
import { startResources } from './resource-session.ts';
import { withResourceChecks } from './resource-checks.ts';

export const testNode = suite('resource checks', [
    test('incomplete observation cannot pass without diagnostic reasons', async function (scope) {
        const observed = withResourceChecks(
            defineResource({
                name: 'owner',
                scope: 'per-case',
                requirements: [],
                acquire() {
                    return true;
                },
                dispose: null
            }),
            function () {
                return {
                    prepare() {
                        return undefined;
                    },
                    finalize() {
                        return { kind: 'incomplete', reasons: [] };
                    }
                };
            }
        );
        const session = await startResources({ resources: { observed }, signal: scope.signal });
        const [ result ] = await Promise.allSettled([ session.disposeOnce({ signal: scope.signal }) ]);
        scope.assert.equal(result.status, 'rejected');
        scope.assert.equal(session.resourceChecks()[0]?.status.kind, 'incomplete');
        return scope.assert.collect();
    }),
    test('synchronous observation overruns fail after returning', async function (scope) {
        const operation = superviseResourceObservation(
            function blockUntilDeadline() {
                const memory = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
                Atomics.wait(memory, 0, 0, 10);
            },
            scope.signal,
            1,
            createClock()
        );
        const [ result ] = await Promise.allSettled([ operation ]);
        scope.assert.equal(result.status, 'rejected');
        return scope.assert.collect();
    }),
    test('composes referenced observers with distinct inputs', async function (scope) {
        const observerModule = new URL('../test-support/resource-check-observer.ts', import.meta.url);
        const reference = defineImplementationReference({
            module: {
                moduleUrl: observerModule.href,
                exportName: 'observer'
            },
            realm: 'host',
            version: '1',
            input: 'first',
            dynamicModules: [],
            parseInput(input) {
                if (typeof input !== 'string') {
                    throw new TypeError('Expected observer input.');
                }
                return input;
            }
        });
        const owner = defineResource({
            name: 'owner',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return true;
            },
            dispose: null
        });
        const observed = withResourceChecks(
            withResourceChecks(owner, defineResourceCheckObserverReference(reference)),
            defineResourceCheckObserverReference(
                defineImplementationReference({ ...reference, input: 'second' })
            )
        );
        const session = await startResources({
            projectRoot: fileURLToPath(new URL('../../', import.meta.url)),
            resources: { observed },
            signal: scope.signal
        });
        await session.disposeOnce({ signal: scope.signal });
        scope.assert.equal(session.context.observed, true);
        scope.assert.equal(session.resourceChecks()[0]?.passing, 2);
        return scope.assert.collect();
    }),
    test('expired supervision still attempts cleanup with an aborted signal', async function (scope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const signals: boolean[] = [];
        const cleanup = superviseResourceObservation(
            function (signal) {
                signals.push(signal.aborted);
            },
            scope.signal,
            0,
            clock
        );
        const [ result ] = await Promise.allSettled([ cleanup ]);
        scope.assert.equal(result.status, 'rejected');
        scope.assert.deepEqual(signals, [ true ]);
        scope.assert.equal(scope.signal.aborted, false);
        return scope.assert.collect();
    }),
    test('retains finalization and cleanup failures', async function (scope) {
        const events: string[] = [];
        const owner = withResourceChecks(
            defineResource({
                name: 'owner',
                scope: 'per-case',
                requirements: [],
                acquire() {
                    return true;
                },
                dispose() {
                    events.push('owner-close');
                    throw new Error('owner failure');
                }
            }),
            function (context) {
                context.cleanup.defer(function () {
                    events.push('observer-close');
                    throw new Error('observer failure');
                });
                return {
                    prepare() {
                        return undefined;
                    },
                    finalize() {
                        events.push('finalize');
                        throw new Error('drain failure');
                    }
                };
            }
        );
        const session = await startResources({ resources: { owner }, signal: scope.signal });
        const [ result ] = await Promise.allSettled([ session.disposeOnce({ signal: scope.signal }) ]);
        scope.assert.equal(result.status, 'rejected');
        scope.assert.deepEqual(events, [ 'owner-close', 'finalize', 'observer-close' ]);
        scope.assert.equal(session.resourceChecks()[0]?.status.kind, 'incomplete');
        return scope.assert.collect();
    }),
    test('observes owner closure and disposes once', async function (scope) {
        const events: string[] = [];
        const owner = defineResource({
            name: 'owner',
            scope: 'per-case',
            requirements: [],
            acquire() {
                events.push('acquire');
                return { secret: true };
            },
            dispose() {
                events.push('owner-close');
            }
        });
        const observed = withResourceChecks(owner, function (context) {
            scope.assert.equal(context.handle.secret, true);
            events.push('install');
            context.cleanup.defer(function () {
                events.push('observer-close');
            });
            return {
                prepare() {
                    events.push('prepare');
                },
                finalize() {
                    events.push('finalize');
                    context.ledger.record({ kind: 'lifetime' }, null, { kind: 'pass' });
                    return { kind: 'complete' };
                }
            };
        });
        const session = await startResources({ resources: { observed }, signal: scope.signal });
        await Promise.all([
            session.disposeOnce({ signal: scope.signal }),
            session.disposeOnce({ signal: scope.signal })
        ]);
        scope.assert.deepEqual(events, [
            'acquire',
            'install',
            'prepare',
            'owner-close',
            'finalize',
            'observer-close'
        ]);
        scope.assert.equal(session.resourceChecks()[0]?.passing, 1);
        return scope.assert.collect();
    }),
    test('failed installation blocks dependents and cleans partial observers', async function (scope) {
        const events: string[] = [];
        const owner = withResourceChecks(
            defineResource({
                name: 'owner',
                scope: 'per-case',
                requirements: [],
                acquire() {
                    return true;
                },
                dispose() {
                    events.push('owner-close');
                }
            }),
            function (context) {
                context.cleanup.defer(function () {
                    events.push('observer-close');
                });
                throw new Error('installation failed');
            }
        );
        const dependent = defineResource({
            name: 'dependent',
            scope: 'per-case',
            requirements: [],
            dependencies: { owner },
            acquire() {
                events.push('dependent');
                return true;
            },
            dispose: null
        });
        let failed = false;
        try {
            await startResources({ resources: { dependent }, signal: scope.signal });
        } catch {
            failed = true;
        }
        scope.assert.equal(failed, true);
        scope.assert.deepEqual(events, [ 'owner-close', 'observer-close' ]);
        return scope.assert.collect();
    })
]);
