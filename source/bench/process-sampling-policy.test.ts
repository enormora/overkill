import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { processSampling } from '../test-support/process-sampling.ts';

export const testNode = suite('process sampling helper ownership', [
    ...([ 'linux', 'darwin' ] as const).map(function (platform) {
        return test(`creates a lazy shared helper on ${platform}`, async function (scope: TestScope) {
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
        });
    }),
    test('cancels an acquired helper and unregisters cancellation after disposal', async function (scope: TestScope) {
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
    }),
    test('does not acquire a helper when disposed before sampling', async function (scope: TestScope) {
        const controller = new AbortController();
        const fixture = processSampling('linux', controller.signal, null);
        await fixture.session.dispose();
        controller.abort();
        scope.assert.deepEqual(fixture.calls, []);
        scope.assert.deepEqual(fixture.created, []);
        return scope.assert.collect();
    }),
    test('rejects process regions created after session disposal', async function (scope: TestScope) {
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
    test('preserves helper close failures and releases ownership only once', async function (scope: TestScope) {
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
    ...([ 'win32', 'unsupported' ] as const).map(function (platform) {
        return test(`rejects unsupported process sampling on ${platform}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                processSampling(platform, scope.signal, null);
            }, { message: 'Process benchmarks support Linux and macOS.' });
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
