import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';
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
    type ResourceConsumerReference,
    ResourceLifecycleError
} from '../../../packages/resources/resources.entry-point.ts';

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
            'deserializeHandle(payload){return {address:payload.url}},exposeHandle:null}};',
            "export const exposed={version:'1',implementation:{",
            'deserializeHandle(payload){return {address:payload.url}},',
            'exposeHandle(handle,context){return {address:handle.address+"#"+context.scenarios.mode}}}};',
            "export const invalid={version:'1',implementation:{",
            'deserializeHandle(payload){return {address:payload.url}},exposeHandle:42}};'
        ]
            .join('\n')
    );
    return await use(directory);
}

function consumerReference(directory: string, exportName: string): ResourceConsumerReference<ConsumerHandle> {
    return defineResourceConsumerReference<ConsumerHandle, null>(defineImplementationReference({
        module: { moduleUrl: pathToFileURL(join(directory, 'consumer.mjs')).href, exportName },
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
    test('requires a consumer projection for per-run resources', function (scope) {
        scope.assert.throws(function missingConsumer() {
            defineResourceReference({
                ...declaration,
                name: 'missing-consumer',
                scope: 'per-run',
                owner: ownerReference('/project', 'owner'),
                consumer: null
            });
        }, { message: 'Per-run resource references require a consumer projection.' });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects consumer projections for shared resources',
        cases: [ 'per-case', 'shared-per-worker' ] as const,
        caseTitle(resourceScope) {
            return resourceScope;
        },
        test(scope) {
            const resourceScope = scope.parameters;

            scope.assert.throws(function incompatibleConsumer() {
                defineResourceReference({
                    ...declaration,
                    name: 'local',
                    scope: resourceScope,
                    owner: ownerReference('/project', 'owner'),
                    consumer: consumerReference('/project', 'consumer')
                });
            }, { message: 'Resource projections require per-run, per-file, or per-suite scope.' });
            return scope.assert.collect();
        }
    }),
    test('requires an owner projection before admitting a consumer', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'missing-projection',
                scope: 'per-file',
                owner: ownerReference(directory, 'exposed'),
                consumer: consumerReference(directory, 'consumer')
            });
            await scope.assert.rejects(async function missingProjection() {
                await startResources({ projectRoot: directory, resources: { resource }, signal: scope.signal });
            }, { message: 'Resource "missing-projection" requires an owner projection.' });
        });
        return scope.assert.collect();
    }),
    table({
        title: 'requires exposure for request-routed scenarios',
        cases: [ 'owner', 'consumer' ] as const,
        caseTitle(role) {
            return role;
        },
        async test(scope) {
            const role = scope.parameters;

            await fixture(scope.signal, async function execute(directory) {
                const resource = defineResourceReference({
                    ...declaration,
                    name: 'missing-view',
                    scope: role === 'owner' ? 'per-case' : 'per-file',
                    owner: ownerReference(directory, 'owner'),
                    consumer: role === 'owner' ? null : consumerReference(directory, 'consumer'),
                    scenarios: { mode: { default: 'first', timing: 'request-routed', values: [ 'first', 'second' ] } }
                });
                await scope.assert.rejects(async function missingExposure() {
                    await startResources({ projectRoot: directory, resources: { resource }, signal: scope.signal });
                }, {
                    message: `Request-routed resource scenarios require ${
                        role === 'owner' ? 'an owner' : 'a consumer'
                    } handle exposure.`
                });
                scope.assert.equal(await readFile(join(directory, 'events.txt'), 'utf8'), '');
            });
            return scope.assert.collect();
        }
    }),
    test('exposes consumer handles through request-routed scenario views', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'consumer-view',
                scope: 'per-file',
                owner: ownerReference(directory, 'owner'),
                consumer: consumerReference(directory, 'exposed'),
                scenarios: { mode: { default: 'first', timing: 'request-routed', values: [ 'first', 'second' ] } }
            });
            await using session = await startResources({
                projectRoot: directory,
                resources: { resource },
                signal: scope.signal
            });
            scope.assert.equal(session.context.resource.address, 'file:///owner#first');
        });
        return scope.assert.collect();
    }),
    test('rejects invalid consumer callbacks before acquiring owner handles', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const resource = defineResourceReference({
                ...declaration,
                name: 'invalid-consumer',
                scope: 'per-file',
                owner: ownerReference(directory, 'owner'),
                consumer: consumerReference(directory, 'invalid')
            });
            await scope.assert.rejects(async function invalidConsumer() {
                await startResources({ projectRoot: directory, resources: { resource }, signal: scope.signal });
            }, { message: /Invalid input/u });
            scope.assert.equal(await readFile(join(directory, 'events.txt'), 'utf8'), '');
        });
        return scope.assert.collect();
    }),
    test(
        'preserves owner disposal failures after closing implementation delivery',
        async function (scope: TestScope) {
            await fixture(scope.signal, async function execute(directory) {
                await writeFile(
                    join(directory, 'dispose.mjs'),
                    'export async function close(){throw new Error("dispose failed")}'
                );
                const resource = defineResourceReference({
                    ...declaration,
                    name: 'failing-disposal',
                    owner: ownerReference(directory, 'owner'),
                    consumer: null
                });
                const session = await startResources({
                    projectRoot: directory,
                    resources: { resource },
                    signal: scope.signal
                });
                let failure: unknown = null;
                try {
                    await session.disposeOnce({ signal: scope.signal });
                } catch (error: unknown) {
                    failure = error;
                }
                scope.require.instanceOf(failure, ResourceLifecycleError);
                scope.assert.deepEqual(
                    failure.failures().map(function describe(entry) {
                        return {
                            phase: entry.phase,
                            resourceName: entry.resourceName,
                            message: entry.cause instanceof Error ? entry.cause.message : String(entry.cause)
                        };
                    }),
                    [ { phase: 'dispose', resourceName: 'failing-disposal', message: 'dispose failed' } ]
                );
            });
            return scope.assert.collect();
        }
    ),
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
                consumer: consumerReference(directory, 'consumer')
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
                consumer: consumerReference(directory, 'consumer')
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
