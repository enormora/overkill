import { parentPort, workerData } from 'node:worker_threads';
import { once } from 'node:events';
import { z } from 'zod/v4';
import { workIdSchema } from '../engine/identity-schema.ts';
import { resourceCheckEndpointSchema } from '../run/resource-check-channel.ts';
import { resourceCheckClient, withWorkerResourceChecks } from '../run/resource-check-client.ts';
import {
    createResourceCheckSession,
    withResourceChecks,
    type ResourceCheckSession
} from '../resources/resource-checks.ts';
import { defineResource } from '../resources/resources.ts';
import type { ResourceCheckWriter } from '../resource-check-protocol.ts';

const input = z.strictObject({ endpoint: resourceCheckEndpointSchema, work: workIdSchema }).parse(workerData);
const port = parentPort;
if (port === null) {
    throw new Error('Resource check fixture requires a worker.');
}
type ObservedWorkerOwner = { readonly session: ResourceCheckSession; readonly writer: ResourceCheckWriter; };
async function createObservedOwner(): Promise<ObservedWorkerOwner> {
    const installed = Promise.withResolvers<ResourceCheckWriter>();
    const resource = withResourceChecks(
        defineResource({
            name: 'worker-owner',
            scope: 'per-run',
            requirements: [],
            acquire() {
                return true;
            },
            dispose: null,
            serializeHandle(handle) {
                return handle;
            },
            deserializeHandle(handle: boolean) {
                return handle;
            }
        }),
        function observe(context) {
            installed.resolve(context.ledger);
            return {
                prepare() {
                    return undefined;
                },
                finalize() {
                    return { kind: 'complete' };
                }
            };
        }
    );
    const session = createResourceCheckSession(resource, true, { kind: 'managed', consumers: [ input.work ] });
    const controller = new AbortController();
    await session.install(controller.signal);
    return { session, writer: await installed.promise };
}
await withWorkerResourceChecks(input.endpoint, async function observeWorkerOwner() {
    const owner = await createObservedOwner();
    await resourceCheckClient(input.endpoint).delivery.flush();
    port.postMessage('ready', []);
    const received: readonly unknown[] = await once(port, 'message');
    owner.writer.requestStop({ kind: 'attempt', work: input.work, attempt: { index: 0 } }, 'remote-target', {
        kind: 'check',
        check: {
            kind: 'leaf',
            id: 'remote-check',
            source: 'assert',
            sourceLocations: [ { kind: 'unknown' } ],
            path: [],
            diff: null,
            actual: { kind: 'boolean', value: false },
            expected: { kind: 'boolean', value: true },
            summary: 'Remote owner failed'
        }
    });
    await resourceCheckClient(input.endpoint).delivery.flush();
    port.postMessage(received[0], []);
    await once(port, 'message');
    await owner.session.close(function disposeOwner() {
        return undefined;
    });
});
port.close();
