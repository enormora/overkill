import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';

import { createDefaultWorkId } from '../../../engine/identity.ts';
import type { ResourceCheckSnapshot } from '../../../resource-check-protocol.ts';
import { withResourceCheckCancellation } from '../../../resource-check-cancellation.ts';
import {
    currentResourceCheckBroker,
    withResourceCheckBroker,
    type ResourceCheckBroker
} from '../../../run/resource-check-broker.ts';
import {
    finalizeRemoteResourceChecks,
    resourceCheckClient,
    withWorkerResourceChecks
} from '../../../run/resource-check-client.ts';

const work = createDefaultWorkId({ file: null, suite: [], title: 'remote consumer', params: null });
async function withObservedWorker(
    cleanup: TestScope['cleanup'],
    inspect: (broker: ResourceCheckBroker, worker: Worker) => Promise<void>
): Promise<void> {
    await withResourceCheckBroker(async function observeRun() {
        const broker = currentResourceCheckBroker();
        if (broker === null) {
            throw new Error('Resource broker is missing.');
        }
        const worker = new Worker(new URL('../../../test-support/resource-check-channel-worker.ts', import.meta.url), {
            workerData: { endpoint: broker.endpoint, work }
        });
        cleanup(async function closeWorker() {
            await worker.terminate();
        });
        await once(worker, 'message');
        await inspect(broker, worker);
    });
}
const assertFinalization = defineCompositeAssertion({
    name: 'finalization',
    async assert(check, broker: ResourceCheckBroker, worker: Worker) {
        worker.postMessage('record', []);
        await once(worker, 'message');
        const finalized = await finalizeRemoteResourceChecks(broker.endpoint, {
            kind: 'attempt',
            work,
            attempt: { index: 0 }
        });
        return check.group([
            check.equal(finalized.errors.length, 0),
            check.true(finalized.snapshots.some(function retained(snapshot) {
                return snapshot.interval.kind === 'attempt' && snapshot.status.kind === 'complete' &&
                    snapshot.failures[0]?.target === 'remote-target';
            }))
        ]);
    }
});

export const testNode = suite('persistent resource check channel', [
    test(
        'closes invalid owner channels and retains incomplete registration evidence',
        async function (scope) {
            await withObservedWorker(scope.cleanup, async function inspect(broker) {
                const client = resourceCheckClient(broker.endpoint);
                const owner = { run: broker.endpoint.token, id: 'duplicate', scope: 'per-run' as const };
                const closed = once(client.socket, 'close');
                client.delivery.register(owner, 'duplicate-service', [ work ], async function finalize() {
                    return undefined;
                });
                client.delivery.register(owner, 'duplicate-service', [ work ], async function finalize() {
                    return undefined;
                });
                await closed;
                scope.assert.true(
                    broker.snapshots().some(function incomplete(snapshot) {
                        return snapshot.owner.id === 'duplicate' && snapshot.status.kind === 'incomplete';
                    })
                );
            });
            return scope.assert.collect();
        }
    ),
    test('delivers remote findings before cancellation and fences finalization', async function (scope) {
        await withObservedWorker(scope.cleanup, async function inspect(broker, worker) {
            let cancellationStopped = false;
            await withWorkerResourceChecks(broker.endpoint, async function consumeObservedOwner() {
                await withResourceCheckCancellation(work, { index: 0 }, function cancel() {
                    cancellationStopped = true;
                }, async function consume() {
                    await scope.assert(assertFinalization, broker, worker);
                });
            });
            scope.assert.true(cancellationStopped);

            worker.postMessage('close', []);
            await once(worker, 'exit');
            scope.assert.true(
                broker.snapshots().every(function complete(snapshot) {
                    return snapshot.status.kind === 'complete';
                })
            );
        });
        return scope.assert.collect();
    }),
    test(
        'retains received findings and marks observation incomplete after owner death',
        async function (scope) {
            await withObservedWorker(scope.cleanup, async function inspect(broker, worker) {
                worker.postMessage('record', []);
                await once(worker, 'message');
                const disconnected = Promise.withResolvers<ResourceCheckSnapshot>();
                broker.observe(function observeDisconnect(snapshot) {
                    if (snapshot.interval.kind === 'attempt' && snapshot.status.kind === 'incomplete') {
                        disconnected.resolve(snapshot);
                    }
                });
                await worker.terminate();
                const snapshot = await disconnected.promise;
                scope.assert.equal(snapshot.failures[0]?.check.summary, 'Remote owner failed');
            });
            return scope.assert.collect();
        }
    )
]);
