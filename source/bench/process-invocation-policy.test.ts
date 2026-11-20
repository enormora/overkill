import { type TestNode, suite, test } from '@overkill-dev/test';

import { processInvocation } from '../test-support/process-invocation.ts';

export const testNode: TestNode = suite('process sample invocation ownership', [
    test('measures exactly one process region and records its observation', async function (scope) {
        const fixture = await processInvocation('pass', scope.signal);
        const result = await fixture.invocation.sample.process(fixture.request);
        fixture.invocation.ensureMeasured();
        scope.assert.equal(fixture.calls.length, 1);
        scope.assert.deepEqual(result.value.completion, { kind: 'exit', code: 0 });
        scope.assert.equal(fixture.observations[0]?.status, 'measured');
        await fixture.invocation.dispose();
        return scope.assert.collect();
    }),
    test('rejects samples that never measure a process region', async function (scope) {
        const fixture = await processInvocation('pass', scope.signal);
        scope.assert.throws(fixture.invocation.ensureMeasured, {
            message: 'Each process sample must await exactly one complete process region.'
        });
        await fixture.invocation.dispose();
        return scope.assert.collect();
    }),
    test('rejects repeated regions even after a successful measurement', async function (scope) {
        const fixture = await processInvocation('pass', scope.signal);
        await fixture.invocation.sample.process(fixture.request);
        await scope.assert.rejects(async function () {
            await fixture.invocation.sample.process(fixture.request);
        }, { message: 'Each process sample must await exactly one process region.' });
        scope.assert.throws(fixture.invocation.ensureMeasured, {
            message: 'Each process sample must await exactly one complete process region.'
        });
        scope.assert.equal(fixture.calls.length, 1);
        await fixture.invocation.dispose();
        return scope.assert.collect();
    }),
    test('preserves failed process observations', async function (scope) {
        const fixture = await processInvocation('failure', scope.signal);
        await scope.assert.rejects(async function () {
            await fixture.invocation.sample.process(fixture.request);
        }, { message: 'Target failed.' });
        scope.assert.equal(fixture.observations[0]?.status, 'failed');
        await fixture.invocation.dispose();
        return scope.assert.collect();
    }),
    test('reports cleanup failures after a completed measurement', async function (scope) {
        const fixture = await processInvocation('cleanup', scope.signal);
        await fixture.invocation.sample.process(fixture.request);
        await scope.assert.rejects(fixture.invocation.dispose, { message: 'Benchmark process cleanup failed.' });
        return scope.assert.collect();
    }),
    test('aborts unfinished regions during disposal and observes their rejection', async function (scope) {
        const fixture = await processInvocation('pending', scope.signal);
        const pending = scope.assert.rejects(async function () {
            await fixture.invocation.sample.process(fixture.request);
        }, { message: 'Process sample was not awaited.' });
        await fixture.ready;
        await fixture.invocation.dispose();
        await pending;
        scope.assert.equal(fixture.calls.length, 1);
        return scope.assert.collect();
    }),
    test('rejects an already cancelled sample before invoking its process helper', async function (scope) {
        const controller = new AbortController();
        const error = new Error('cancelled');
        controller.abort(error);
        const fixture = await processInvocation('pass', controller.signal);
        await scope.assert.rejects(async function () {
            await fixture.invocation.sample.process(fixture.request);
        }, { exact: error });
        scope.assert.deepEqual(fixture.calls, []);
        await fixture.invocation.dispose();
        return scope.assert.collect();
    })
]);
