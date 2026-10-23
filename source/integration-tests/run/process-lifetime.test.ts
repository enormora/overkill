import { suite, test } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { processMeasurement, type ProcessRequest } from '../../packages/bench/bench.entry-point.ts';
import { createProcessSamplingSession } from '../../bench/process-sampling.ts';
import { runIfMain } from '#test-runner';

const request: ProcessRequest = {
    command: [ process.execPath, '-e', 'process.stdout.write("Ready");setInterval(()=>{},1000)' ],
    cwd: process.cwd(),
    env: null,
    io: { kind: 'pipes' },
    completion: { kind: 'ready', marker: { stream: 'stdout', text: 'Ready' } }
};

export const testNode = suite('process sample lifetime', [
    test('rejects missing regions and calls after disposal', async function (scope) {
        const session = createProcessSamplingSession(processMeasurement({ instrumentation: 'off' }), scope.signal);
        const invocation = session.sample('measured');
        scope.assert.throws(invocation.ensureMeasured, { message: /exactly one/u });
        await invocation.dispose();
        await scope.assert.rejects(async function () {
            return await invocation.sample.process(request);
        }, { message: /exactly one/u });
        await session.dispose();
        return scope.assert.collect();
    }),
    test('rejects repeated regions even when the body catches the error', async function (scope) {
        const session = createProcessSamplingSession(processMeasurement({ instrumentation: 'off' }), scope.signal);
        const invocation = session.sample('measured');
        const measured = await invocation.sample.process(request);
        scope.assert.equal(measured.value.completion.kind, 'ready');
        await scope.assert.rejects(async function () {
            return await invocation.sample.process(request);
        }, { message: /exactly one/u });
        scope.assert.throws(invocation.ensureMeasured, { message: /exactly one/u });
        await invocation.dispose();
        await session.dispose();
        return scope.assert.collect();
    }),
    test('cancels an unfinished region before closing its helper', async function (scope) {
        const session = createProcessSamplingSession(processMeasurement({ instrumentation: 'off' }), scope.signal);
        const invocation = session.sample('measured');
        const pending = invocation.sample.process({
            ...request,
            completion: { kind: 'ready', marker: { stream: 'stdout', text: 'Never' } }
        });
        const rejected = scope.assert.rejects(async function () {
            return await pending;
        }, { message: /not awaited/u });
        scope.assert.throws(invocation.ensureMeasured, { message: /exactly one/u });
        await invocation.dispose();
        await rejected;
        await session.dispose();
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
