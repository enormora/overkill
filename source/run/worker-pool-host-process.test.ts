import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';
import {
    type ForwardingFixture,
    workerPoolOptions,
    commandKind,
    newRangeError,
    ignoreStartOptions,
    createPoolFixture,
    waitForRunTaskCommand,
    startRunTask,
    emitTaskOutput,
    resolveTask,
    createForwardingFixture,
    createTrackingFixture,
    collectTwoProcessUsageSamples,
    startTrackingWithOneSample
} from '../test-support/hosted-worker-pool-fixture.ts';
import { serializeError } from './worker-pool-host-protocol.ts';

const assertForwardingResult = defineCompositeAssertion({
    name: 'forwarding result',
    async assert(check, fixture: ForwardingFixture) {
        return check.group([
            check.deepEqual(await fixture.result, { ok: true }),
            check.deepEqual(fixture.output, [ 'stdout:host stdout', 'stderr:host stderr' ]),
            check.deepEqual(fixture.port.messages(), [ {
                capturedAtMicroseconds: 50,
                chunk: Buffer.from('task stdout'),
                kind: 'output',
                stream: 'stdout'
            } ]),
            check.deepEqual(fixture.child.sentCommands().map(commandKind), [ 'configure', 'run-task', 'abort-task' ]),
            check.equal(fixture.pool.options.maxThreads, 2)
        ]);
    }
});

export const testNode = suite('Hosted worker pools', [
    test('reports a missing host process usage sample', function (scope: TestScope) {
        const { pool } = createPoolFixture(scope.cleanup, workerPoolOptions(), ignoreStartOptions);
        const tracker = pool.createProcessUsageTracker?.({ samplingIntervalMilliseconds: 25 });

        scope.require.defined(tracker);
        scope.assert.throws(function finishWithoutSamples() {
            tracker.finish();
        }, {
            message: 'Hosted worker-pool process usage tracking did not receive samples.'
        });

        return scope.assert.collect();
    }),
    test('rejects task errors from the child host', async function (scope) {
        const fixture = await startRunTask(createPoolFixture(
            scope.cleanup,
            workerPoolOptions({ hostProcess: { kind: 'direct' } }),
            function expectDirectHost(options) {
                scope.assert.deepEqual(options.nodeArguments, []);
            }
        ));
        const runTaskCommand = await waitForRunTaskCommand(fixture.child);

        fixture.child.emitMessage({
            error: serializeError(newRangeError('task failed')),
            kind: 'task-error',
            taskId: runTaskCommand.taskId
        });

        await scope.assert.rejects(async function waitForTaskError() {
            await fixture.result;
        }, {
            message: 'task failed',
            name: 'RangeError'
        });

        return scope.assert.collect();
    }),
    test(
        'forwards tasks, output, messages, and aborts',
        async function (scope) {
            const fixture = createForwardingFixture(scope.cleanup, function (options) {
                scope.assert(
                    defineCompositeAssertion({
                        name: 'forwards tasks, output, messages, and aborts',
                        assert(check) {
                            return check.group([
                                check.deepEqual(options.nodeArguments, [ '--expose-gc' ]),
                                check
                                    .equal(
                                        options.testFamily,
                                        'integration'
                                    )
                            ]);
                        }
                    })
                );
            });

            const runTaskCommand = await waitForRunTaskCommand(fixture.child);

            emitTaskOutput(fixture.child, runTaskCommand);
            fixture.controller.abort();
            resolveTask(fixture.child, runTaskCommand);
            await scope.assert(assertForwardingResult, fixture);
            scope.assert.equal(fixture.pool.options.isolateWorkers, false);

            return scope.assert.collect();
        }
    ),
    test('exposes host process usage samples', async function (scope) {
        const fixture = createTrackingFixture(scope.cleanup);
        const usage = await collectTwoProcessUsageSamples(fixture);

        scope.assert(defineCompositeAssertion({
            name: 'exposes host process usage samples',
            assert(check) {
                return check.group([
                    check.deepEqual(fixture.observedSamples, [ 10, 20 ]),
                    check.equal(usage.sampleCount, 2),
                    check.equal(usage.peakResidentSetBytes, 260),
                    check.equal(fixture.pool.options.isolateWorkers, true),
                    check.deepEqual(
                        fixture.child.sentCommands().map(commandKind),
                        [ 'configure', 'start-process-usage-tracking', 'finish-process-usage-tracking' ]
                    )
                ]);
            }
        }));

        return scope.assert.collect();
    }),
    test('rejects pending tasks when the host errors', async function (scope) {
        const fixture = await startRunTask(createPoolFixture(scope.cleanup, workerPoolOptions(), ignoreStartOptions));

        fixture.child.emitError(new Error('host failed'));

        await scope.assert.rejects(async function waitForHostFailure() {
            await fixture.result;
        }, { message: 'host failed' });

        return scope.assert.collect();
    }),
    test(
        'destroys an active host and ignores idle destroy',
        async function (scope: TestScope) {
            const fixture = createPoolFixture(scope.cleanup, workerPoolOptions(), ignoreStartOptions);
            const tracker = fixture.pool.createProcessUsageTracker?.({ samplingIntervalMilliseconds: 25 });

            scope.require.defined(tracker);
            await startTrackingWithOneSample(fixture.child, tracker);
            await fixture.pool.destroy();
            await fixture.pool.destroy();

            scope.assert.deepEqual(
                fixture.child.sentCommands().map(commandKind),
                [ 'configure', 'start-process-usage-tracking', 'destroy' ]
            );

            return scope.assert.collect();
        }
    )
]);
