import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { setImmediate as scheduleDeliveryTurn } from 'node:timers';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { withResourceCheckCancellation } from '../resource-check-cancellation.ts';
import {
    currentResourceCheckBroker,
    withResourceCheckBroker,
    type ResourceCheckBroker
} from './resource-check-broker.ts';
import {
    finalizeRemoteResourceChecks,
    resourceCheckClient,
    withWorkerResourceChecks
} from './resource-check-client.ts';

const work = createDefaultWorkId({ file: null, suite: [], title: 'remote consumer', params: null });
async function withObservedWorker(
    scope: TestScope,
    inspect: (broker: ResourceCheckBroker, worker: Worker) => Promise<void>
): Promise<void> {
    await withResourceCheckBroker(async function observeRun() {
        const broker = currentResourceCheckBroker();
        if (broker === null) {
            throw new Error('Resource broker is missing.');
        }
        const worker = new Worker(new URL('../test-support/resource-check-channel-worker.ts', import.meta.url), {
            workerData: { endpoint: broker.endpoint, work }
        });
        scope.cleanup(async function closeWorker() {
            await worker.terminate();
        });
        await once(worker, 'message');
        await inspect(broker, worker);
    });
}
async function assertFinalization(scope: TestScope, broker: ResourceCheckBroker, worker: Worker): Promise<void> {
    worker.postMessage('record', []);
    await once(worker, 'message');
    const finalized = await finalizeRemoteResourceChecks(broker.endpoint, {
        kind: 'attempt',
        work,
        attempt: { index: 0 }
    });
    scope.assert.equal(finalized.errors.length, 0);
    scope.assert.true(finalized.snapshots.some(function retained(snapshot) {
        return snapshot.interval.kind === 'attempt' && snapshot.status.kind === 'complete' &&
            snapshot.failures[0]?.target === 'remote-target';
    }));
}
async function assertCancellation(scope: TestScope, broker: ResourceCheckBroker, worker: Worker): Promise<void> {
    let stopped = false;
    await withWorkerResourceChecks(broker.endpoint, async function consumeObservedOwner() {
        await withResourceCheckCancellation(work, { index: 0 }, function cancel() {
            stopped = true;
        }, async function consume() {
            await assertFinalization(scope, broker, worker);
        });
    });
    scope.assert.true(stopped);
}
export const testNode = suite('persistent resource check channel', [
    test('closes invalid owner channels and retains incomplete registration evidence', async function (scope) {
        await withObservedWorker(scope, async function inspect(broker) {
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
    }),
    test('delivers remote findings before cancellation and fences finalization', async function (scope) {
        await withObservedWorker(scope, async function inspect(broker, worker) {
            await assertCancellation(scope, broker, worker);
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
    test('retains received findings and marks observation incomplete after owner death', async function (scope) {
        await withObservedWorker(scope, async function inspect(broker, worker) {
            worker.postMessage('record', []);
            await once(worker, 'message');
            await worker.terminate();
            await new Promise<void>(function deliveryTurn(resolve) {
                scheduleDeliveryTurn(resolve);
            });
            scope.assert.true(
                broker.snapshots().some(function retained(snapshot) {
                    return snapshot.failures[0]?.check.summary === 'Remote owner failed';
                })
            );
            scope.assert.true(
                broker.snapshots().some(function interrupted(snapshot) {
                    return snapshot.status.kind === 'incomplete';
                })
            );
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
