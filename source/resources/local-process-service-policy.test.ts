import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { serializeProjectedHandle, deserializeProjectedHandle } from '../run/resource-lifecycle-projection.ts';

import { localProcessService, type ProcessConsumer } from '../test-support/local-process-service.ts';
import { createLocalProcessServiceResource } from './local-process-service-resource.ts';

export const testNode: TestNode = suite('local process service ownership', [
    test('projects per-run process consumer handles without starting an owner', function (scope) {
        const fixture = localProcessService(scope, 'graceful', 'ready');
        const resource = createLocalProcessServiceResource({
            ...fixture.input,
            scope: 'per-run',
            serializeHandle(handle: ProcessConsumer) {
                return handle.endpoint;
            },
            deserializeHandle(endpoint: string) {
                return { endpoint };
            }
        });
        scope.assert.equal(resource.scope, 'per-run');
        scope.assert.deepEqual<unknown, unknown>(serializeProjectedHandle(resource, { endpoint: 'owner' }, {}), {
            payload: 'owner'
        });
        scope.assert.deepEqual<unknown, unknown>(deserializeProjectedHandle(resource, 'consumer', {}), {
            endpoint: 'consumer'
        });
        scope.assert.deepEqual(fixture.commands, []);
        return scope.assert.collect();
    }),
    table({
        title: 'requires callbacks for projected processes',
        cases: [ 'serializeHandle', 'deserializeHandle' ] as const,
        caseTitle(missing) {
            return `${missing}`;
        },
        test(scope) {
            const missing = scope.parameters;

            const fixture = localProcessService(scope, 'graceful', 'ready');
            const input = {
                ...fixture.input,
                scope: 'per-run',
                serializeHandle() {
                    return 'owner';
                },
                deserializeHandle() {
                    return { endpoint: 'consumer' };
                },
                [missing]: undefined
            };
            scope.assert.throws(function () {
                Reflect.apply(createLocalProcessServiceResource, undefined, [ input ]);
            }, { message: 'Projected local process services require handle projection callbacks.' });
            scope.assert.deepEqual(fixture.commands, []);
            return scope.assert.collect();
        }
    }),

    test(
        'forwards command settings and exposes captured output to readiness',
        async function (scope) {
            const fixture = localProcessService(scope, 'graceful', 'ready');
            const owner = await fixture.definition.start(fixture.context);
            scope.assert.deepEqual(await fixture.definition.ready(owner, fixture.context), { endpoint: 'ready' });
            scope.assert.deepEqual(fixture.commands, [ {
                command: 'service',
                arguments: [ 'start' ],
                environment: { MODE: 'test' },
                workingDirectory: '/project'
            } ]);
            scope.assert.equal(owner.output.stdout.text(), 'started');
            scope.assert.equal(owner.output.stderr.text(), 'diagnostic');
            await fixture.definition.dispose(owner, fixture.context);
            scope.assert.deepEqual(fixture.signals, [ 'SIGTERM' ]);
            return scope.assert.collect();
        }
    ),
    test(
        'forces shutdown after the grace budget and waits for process exit',
        async function (scope) {
            const fixture = localProcessService(scope, 'forced', 'ready');
            const owner = await fixture.definition.start(fixture.context);
            await fixture.definition.dispose(owner, fixture.context);
            await fixture.definition.dispose(owner, fixture.context);
            scope.assert.deepEqual(fixture.signals, [ 'SIGTERM', 'SIGKILL' ]);
            scope.assert.equal(fixture.waits[0]?.milliseconds, 50);
            scope.assert.true(fixture.waits[0]?.signal.aborted);
            return scope.assert.collect();
        }
    ),
    test('does not signal an already exited process', async function (scope) {
        const fixture = localProcessService(scope, 'graceful', 'ready');
        const owner = await fixture.definition.start(fixture.context);
        fixture.exit(0, null);
        await fixture.definition.dispose(owner, fixture.context);
        scope.assert.deepEqual(fixture.signals, []);
        scope.assert.deepEqual(fixture.waits, []);
        return scope.assert.collect();
    }),
    test(
        'rejects readiness when the child already exited before observation began',
        async function (scope) {
            const fixture = localProcessService(scope, 'graceful', 'ready');
            const owner = await fixture.definition.start(fixture.context);
            fixture.exit(1, null);
            await scope.assert.rejects(async function () {
                await fixture.definition.ready(owner, fixture.context);
            }, { message: 'Local process service exited before readiness: code 1, signal null.\ndiagnostic' });
            await fixture.definition.dispose(owner, fixture.context);
            return scope.assert.collect();
        }
    ),
    test('preserves process signalling failures', async function (scope) {
        const fixture = localProcessService(scope, 'throws', 'ready');
        const owner = await fixture.definition.start(fixture.context);
        await scope.assert.rejects(async function () {
            await fixture.definition.dispose(owner, fixture.context);
        }, { message: 'Signal failed.' });
        scope.assert.deepEqual(fixture.signals, [ 'SIGTERM' ]);
        return scope.assert.collect();
    }),
    test('retains readiness callback failures', async function (scope) {
        const fixture = localProcessService(scope, 'graceful', 'failed');
        const owner = await fixture.definition.start(fixture.context);
        await scope.assert.rejects(async function () {
            await fixture.definition.ready(owner, fixture.context);
        }, { message: 'Readiness failed.' });
        await fixture.definition.dispose(owner, fixture.context);
        return scope.assert.collect();
    }),
    test(
        'rejects readiness when the process exits and includes stderr evidence',
        async function (scope) {
            const fixture = localProcessService(scope, 'graceful', 'exit');
            const owner = await fixture.definition.start(fixture.context);
            await scope.assert.rejects(async function () {
                await fixture.definition.ready(owner, fixture.context);
            }, { message: 'Local process service exited before readiness: code 1, signal null.\ndiagnostic' });
            await fixture.definition.dispose(owner, fixture.context);
            return scope.assert.collect();
        }
    ),
    test('rejects readiness when the child reports a process error', async function (scope) {
        const fixture = localProcessService(scope, 'graceful', 'error');
        const owner = await fixture.definition.start(fixture.context);
        await scope.assert.rejects(async function () {
            await fixture.definition.ready(owner, fixture.context);
        }, { message: 'Process failed.' });
        await fixture.definition.dispose(owner, fixture.context);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid output and shutdown bounds',
        cases: [ -1, 1.5, Number.NaN ],
        caseTitle(value) {
            return `rejects invalid output and shutdown bounds ${String(value)}`;
        },
        test(scope) {
            const value = scope.parameters;

            const fixture = localProcessService(scope, 'graceful', 'ready');
            scope.assert.throws(function () {
                createLocalProcessServiceResource({ ...fixture.input, outputBufferBytes: value });
            }, { message: 'Local process service outputBufferBytes must be a non-negative integer.' });
            scope.assert.throws(function () {
                createLocalProcessServiceResource({
                    ...fixture.input,
                    shutdown: { ...fixture.input.shutdown, graceMilliseconds: value }
                });
            }, { message: 'Local process service shutdown.graceMilliseconds must be a non-negative integer.' });
            return scope.assert.collect();
        }
    })
]);
