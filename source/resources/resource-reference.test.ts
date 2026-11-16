import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    createTemporaryDirectoryResource,
    defineImplementationReference,
    defineResourceConsumerReference,
    defineResourceOwnerReference,
    defineResourceReference,
    startResources,
    startRuntime,
    defineRuntime,
    type ResourceOwnerReference,
    type ResourceConsumerReference
} from '../packages/resources/resources.entry-point.ts';

const declaration = { dependencies: {}, requirements: [], scenarios: {}, scope: 'per-case', workload: null } as const;
const inputSchema = z.strictObject({ events: z.string(), url: z.string() });
type Input = Readonly<z.infer<typeof inputSchema>>;
type ConsumerHandle = { readonly address: string; };

function ownerReference(directory: string, exportName: string): ResourceOwnerReference<URL> {
    return defineResourceOwnerReference<URL, Input>(defineImplementationReference({
        module: { moduleUrl: pathToFileURL(join(directory, 'owner.mjs')).href, exportName },
        realm: 'host',
        version: '1',
        dynamicModules: [],
        input: { events: 'events.txt', url: 'file:///owner' },
        parseInput(value, context) {
            const input = inputSchema.parse(value);
            return { ...input, events: join(context.projectRoot, input.events) };
        }
    }));
}

async function fixture<Value>(
    signal: Readonly<AbortSignal>,
    use: (directory: string) => Promise<Value>
): Promise<Value> {
    await using session = await startResources({
        resources: { directory: createTemporaryDirectoryResource('directory') },
        signal
    });
    const directory = session.context.directory.path;
    await writeFile(join(directory, 'events.txt'), '');
    await writeFile(
        join(directory, 'owner.mjs'),
        [
            "import {appendFile} from 'node:fs/promises';",
            "export const owner={version:'1',implementation:{",
            "async acquire(context,input){await appendFile(input.events,'acquire\\n');return new URL(input.url)},",
            "async dispose(handle,context,input){const {close}=await import('./dispose.mjs');await close(input.events)},",
            'exposeHandle:null,serializeHandle(handle){return {url:handle.href}}}};',
            "export const exposed={version:'1',implementation:{acquire(context,input){return new URL(input.url)},",
            'dispose:null,serializeHandle:null,exposeHandle(handle,context){return new URL(handle.href+"#"+context.scenarios.mode)}}};',
            "export const invalid={version:'1',implementation:{",
            'acquire(){return new URL("file:///invalid")},dispose:null,exposeHandle:null,serializeHandle(handle){return handle}}};'
        ]
            .join('\n')
    );
    await writeFile(
        join(directory, 'dispose.mjs'),
        [
            "import {appendFile} from 'node:fs/promises';",
            "export async function close(events){await appendFile(events,'dispose\\n')}"
        ]
            .join('\n')
    );
    await writeFile(
        join(directory, 'consumer.mjs'),
        [
            "export const consumer={version:'1',implementation:{",
            'deserializeHandle(payload){return {address:payload.url}},exposeHandle:null}};'
        ]
            .join('\n')
    );
    return await use(directory);
}

function consumerReference(directory: string): ResourceConsumerReference<ConsumerHandle> {
    return defineResourceConsumerReference<ConsumerHandle, null>(defineImplementationReference({
        module: { moduleUrl: pathToFileURL(join(directory, 'consumer.mjs')).href, exportName: 'consumer' },
        realm: 'host',
        version: '1',
        dynamicModules: [],
        input: null,
        parseInput(input) {
            return z.null().parse(input);
        }
    }));
}

export const testNode = suite('referenced resource sessions', [
    test('starts a rooted runtime with referenced native handles', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'native',
                owner: ownerReference(directory, 'exposed'),
                consumer: null
            });
            const runtime = defineRuntime({
                name: 'runtime',
                dimensions: {},
                requirements: [],
                resources: { resource }
            });
            await using session = await startRuntime({ runtime, projectRoot: directory, signal: scope.signal });
            scope.assert.equal(session.context.resource instanceof URL, true);
        });
        return scope.assert.collect();
    }),
    test('keeps native owner handles and frozen dynamic imports through disposal', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'owner',
                owner: ownerReference(directory, 'owner'),
                consumer: null
            });
            scope.assert.equal(await readFile(join(directory, 'events.txt'), 'utf8'), '');
            const session = await startResources({
                projectRoot: directory,
                resources: { resource },
                signal: scope.signal
            });
            scope.assert.equal(session.context.resource instanceof URL, true);
            scope.assert.equal(session.context.resource.href, 'file:///owner');
            await writeFile(join(directory, 'dispose.mjs'), 'throw new Error("changed after admission")');
            await session.disposeOnce({ signal: scope.signal });
            await session.disposeOnce({ signal: scope.signal });
            scope.assert.equal(await readFile(join(directory, 'events.txt'), 'utf8'), 'acquire\ndispose\n');
        });
        return scope.assert.collect();
    }),
    test('exposes native owner handles with request-routed scenario views', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'exposed',
                owner: ownerReference(directory, 'exposed'),
                consumer: null,
                scenarios: { mode: { default: 'first', timing: 'request-routed', values: [ 'first', 'second' ] } }
            });
            await using session = await startResources({
                projectRoot: directory,
                resources: { resource },
                signal: scope.signal
            });
            scope.assert.equal(session.context.resource.hash, '#first');
        });
        return scope.assert.collect();
    }),
    test('projects portable payloads into separate consumer handles', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'projected',
                scope: 'per-file',
                owner: ownerReference(directory, 'owner'),
                consumer: consumerReference(directory)
            });
            await using session = await startResources({
                projectRoot: directory,
                resources: { resource },
                signal: scope.signal
            });
            scope.assert.equal(session.context.resource.address, 'file:///owner');
            scope.assert.equal(session.context.resource instanceof URL, false);
        });
        return scope.assert.collect();
    }),
    test('rejects native handles returned as projection payloads', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'invalid',
                scope: 'per-file',
                owner: ownerReference(directory, 'invalid'),
                consumer: consumerReference(directory)
            });
            await scope.assert.rejects(async function projectInvalidHandle() {
                await startResources({ projectRoot: directory, resources: { resource }, signal: scope.signal });
            }, { message: 'Resource acquisition failed.' });
        });
        return scope.assert.collect();
    }),
    test('validates every named implementation before admitting acquisition', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const valid = defineResourceReference({
                ...declaration,
                name: 'valid',
                owner: ownerReference(directory, 'owner'),
                consumer: null
            });
            const missing = defineResourceReference({
                ...declaration,
                name: 'missing',
                owner: ownerReference(directory, 'missing'),
                consumer: null
            });
            await scope.assert.rejects(async function missingImplementation() {
                await startResources({ projectRoot: directory, resources: { valid, missing }, signal: scope.signal });
            }, { message: 'Missing implementation export: missing' });
            scope.assert.equal(await readFile(join(directory, 'events.txt'), 'utf8'), '');
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
