import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { processSampling } from '../test-support/process-sampling.ts';

export const testNode: TestNode = suite('process sampling helper ownership', [
    table({
        title: 'creates a lazy shared helper on supported platforms',
        cases: [ 'linux', 'darwin' ] as const,
        caseTitle(platform) {
            return platform;
        },
        async test(scope) {
            const platform = scope.parameters;

            const fixture = processSampling(platform, scope.signal, null);
            scope.assert.deepEqual(Array.from(fixture.created), []);
            await scope.assert.rejects(async function () {
                await fixture.measure('warmup');
            }, { message: 'Target failed.' });
            await scope.assert.rejects(async function () {
                await fixture.measure('measured');
            }, { message: 'Target failed.' });
            await fixture.session.dispose();
            scope.assert.equal(fixture.created.length, 1);
            scope.assert.equal(fixture.created[0]?.instrumentation, 'off');
            scope.assert.deepEqual(fixture.calls, [ 'run', 'run', 'close' ]);
            return scope.assert.collect();
        }
    }),
    test(
        'cancels an acquired helper and unregisters cancellation after disposal',
        async function (scope) {
            const controller = new AbortController();
            const fixture = processSampling('linux', controller.signal, null);
            const sample = fixture.session.sample('measured');
            await scope.assert.rejects(async function () {
                await sample.sample.process(fixture.request);
            }, { message: 'Target failed.' });
            controller.abort(new Error('cancel'));
            await sample.dispose();
            await fixture.session.dispose();
            await fixture.session.dispose();
            scope.assert.deepEqual(fixture.calls, [ 'run', 'cancel', 'close' ]);
            return scope.assert.collect();
        }
    ),
    test('does not acquire a helper when disposed before sampling', async function (scope) {
        const controller = new AbortController();
        const fixture = processSampling('linux', controller.signal, null);
        await fixture.session.dispose();
        controller.abort();
        scope.assert.deepEqual(fixture.calls, []);
        scope.assert.deepEqual(fixture.created, []);
        return scope.assert.collect();
    }),
    test('rejects process regions created after session disposal', async function (scope) {
        const fixture = processSampling('linux', scope.signal, null);
        await fixture.session.dispose();
        const sample = fixture.session.sample('measured');
        await scope.assert.rejects(async function () {
            await sample.sample.process(fixture.request);
        }, { message: 'Process sampling session is closed.' });
        await sample.dispose();
        scope.assert.deepEqual(fixture.created, []);
        return scope.assert.collect();
    }),
    test('preserves helper close failures and releases ownership only once', async function (scope) {
        const failure = new Error('helper close failed');
        const fixture = processSampling('linux', scope.signal, failure);
        const sample = fixture.session.sample('measured');
        await scope.assert.rejects(async function () {
            await sample.sample.process(fixture.request);
        }, { message: 'Target failed.' });
        await sample.dispose();
        await scope.assert.rejects(fixture.session.dispose, { exact: failure });
        await fixture.session.dispose();
        scope.assert.deepEqual(fixture.calls, [ 'run', 'close' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects unsupported sampling platforms',
        cases: [ 'win32', 'unsupported' ] as const,
        caseTitle(platform) {
            return platform;
        },
        test(scope) {
            const platform = scope.parameters;

            scope.assert.throws(function () {
                processSampling(platform, scope.signal, null);
            }, { message: 'Process benchmarks support Linux and macOS.' });
            return scope.assert.collect();
        }
    })
]);
