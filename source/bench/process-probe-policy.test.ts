import { type TestNode, suite, test } from '@overkill-dev/test';

import { processProbeChannel, probeChannelScenario } from '../test-support/process-probe-channel.ts';

export const testNode: TestNode = suite('node process probe ownership', [
    test('authenticates the child and requests a live checkpoint', async function (scope) {
        const fixture = await processProbeChannel(scope, probeChannelScenario);
        fixture.probe.identify(42);
        fixture.deliver({ token: 'unit-probe-token', pid: 42 });
        const pending = fixture.probe.checkpointSnapshot(Promise.resolve());
        fixture.deliver(fixture.report);
        scope.assert.deepEqual(await pending, fixture.report);
        scope.assert.deepEqual(fixture.probe.environment, {
            OVERKILL_BENCH_PROBE_PORT: '4321',
            OVERKILL_BENCH_PROBE_TOKEN: 'unit-probe-token',
            OVERKILL_BENCH_PROBE_REPORT: '/unit-report.json'
        });
        await fixture.probe.dispose();
        scope.assert.deepEqual(fixture.events, [ 'snapshot\n', 'close', 'dispose-report' ]);
        return scope.assert.collect();
    }),
    test('reads final evidence from report storage', async function (scope) {
        const fixture = await processProbeChannel(scope, probeChannelScenario);
        scope.assert.deepEqual(await fixture.probe.finalSnapshot(), fixture.report);
        await fixture.probe.dispose();
        scope.assert.deepEqual(fixture.events, [ 'read', 'close', 'dispose-report' ]);
        return scope.assert.collect();
    }),
    test(
        'falls back to final evidence when the checkpoint deadline expires after child exit',
        async function (scope) {
            const fixture = await processProbeChannel(scope, { ...probeChannelScenario, snapshotTimeout: true });
            scope.assert.deepEqual(await fixture.probe.checkpointSnapshot(Promise.resolve()), fixture.report);
            await fixture.probe.dispose();
            scope.assert.deepEqual(fixture.events, [ 'read', 'close', 'dispose-report' ]);
            return scope.assert.collect();
        }
    ),
    test('rejects wrong child identities before admitting probe reports', async function (scope) {
        const fixture = await processProbeChannel(scope, probeChannelScenario);
        fixture.probe.identify(42);
        fixture.deliver({ token: 'wrong', pid: 42 });
        await scope.assert.rejects(
            async function () {
                return fixture.probe.checkpointSnapshot(Promise.reject(new Error('Child still active.')));
            },
            { message: 'Child still active.' }
        );
        scope.assert.true(fixture.socket.destroyed);
        await fixture.probe.dispose();
        return scope.assert.collect();
    }),
    test('uses final evidence when an invalid report arrives after child exit', async function (scope) {
        const fixture = await processProbeChannel(scope, probeChannelScenario);
        fixture.probe.identify(42);
        fixture.deliver({ token: 'unit-probe-token', pid: 42 });
        fixture.deliver({ version: 'invalid' });
        scope.assert.deepEqual(await fixture.probe.checkpointSnapshot(Promise.resolve()), fixture.report);
        await fixture.probe.dispose();
        return scope.assert.collect();
    }),
    test('finishes report storage cleanup even when closing the listener fails', async function (scope) {
        const failure = new Error('Cannot close listener.');
        const fixture = await processProbeChannel(scope, { ...probeChannelScenario, closeError: failure });
        await scope.assert.rejects(async function () {
            return fixture.probe.dispose();
        }, { exact: failure });
        scope.assert.equal(fixture.events.at(-1), 'dispose-report');
        return scope.assert.collect();
    }),
    test('cleans up failed listeners and invalid loopback addresses', async function (scope) {
        const failure = new Error('Cannot listen.');
        await scope.assert.rejects(
            async function () {
                return processProbeChannel(scope, { ...probeChannelScenario, listenError: failure });
            },
            { exact: failure }
        );
        await scope.assert.rejects(async function () {
            return processProbeChannel(scope, { ...probeChannelScenario, address: null });
        }, {
            message: 'Node probe requires a loopback endpoint.'
        });
        return scope.assert.collect();
    }),
    test('bounds probe frames and recovers final evidence after transport errors', async function (scope) {
        const fixture = await processProbeChannel(scope, probeChannelScenario);
        fixture.socket.push('x'.repeat(65_537));
        scope.assert.deepEqual(await fixture.probe.checkpointSnapshot(Promise.resolve()), fixture.report);
        await fixture.probe.dispose();
        scope.assert.true(fixture.socket.destroyed);
        return scope.assert.collect();
    })
]);
