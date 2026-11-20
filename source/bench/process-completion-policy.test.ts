import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { completionProcess } from '../test-support/process-completion.ts';
import { completeProcess } from './process-interactions.ts';
import { processCheckpoint, withProcessTimeline, type ProcessCheckpoint } from './process-timeline.ts';

const expectedExit = { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] } as const;
export const testNode: TestNode = suite('process completion and timeline policy', [
    test('returns the exit boundary after the complete script', async function (scope) {
        const fixture = completionProcess(0, null);
        fixture.output.append('stdout', Buffer.from('ready'));
        const result = await completeProcess(
            {
                ...expectedExit,
                readiness: { stream: 'stdout', text: 'ready' },
                steps: [ { kind: 'write', text: 'first' }, {
                    kind: 'expect',
                    marker: { stream: 'stdout', text: 'answer' }
                }, { kind: 'close-input' } ]
            },
            fixture.child,
            fixture.output
        );
        scope.assert.equal(result.time, 1234n);
        scope.assert.deepEqual<unknown, unknown>(result.exit, { code: 0, signal: null, time: 1234n });
        scope.assert.equal(typeof result.readiness, 'bigint');
        scope.assert.deepEqual(result.interactions, {});
        scope.assert.deepEqual(fixture.calls, [ 'write:first', 'close' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects unexpected exits',
        cases: [ { code: null, signal: null }, { code: 1, signal: null }, { code: 0, signal: 'SIGTERM' } ] as const,
        caseTitle(exit) {
            return `${String(exit.code)}, ${String(exit.signal)}`;
        },
        async test(scope) {
            const exit = scope.parameters;

            const fixture = completionProcess(exit.code, exit.signal);
            await scope.assert.rejects(async function () {
                await completeProcess(expectedExit, fixture.child, fixture.output);
            }, {
                message: `Process exited unexpectedly: code ${String(exit.code)}, signal ${String(exit.signal)}.`
            });
            return scope.assert.collect();
        }
    }),
    test('accepts an explicitly allowed nonzero exit', async function (scope) {
        const fixture = completionProcess(7, null);
        const result = await completeProcess(
            { ...expectedExit, expectedExitCodes: [ 7 ] },
            fixture.child,
            fixture.output
        );
        scope.assert.equal(result.exit?.code, 7);
        scope.assert.equal(result.readiness, null);
        return scope.assert.collect();
    }),
    test(
        'uses readiness as the completion boundary without waiting for exit',
        async function (scope) {
            const fixture = completionProcess(1, 'SIGTERM');
            fixture.output.append('stdout', Buffer.from('ready'));
            const result = await completeProcess(
                { kind: 'ready', marker: { stream: 'stdout', text: 'ready' } },
                fixture.child,
                fixture.output
            );
            scope.assert.equal(result.readiness, result.time);
            scope.assert.equal(result.exit, null);
            scope.assert.deepEqual(fixture.calls, []);
            return scope.assert.collect();
        }
    ),
    test(
        'measures interaction completion and preserves the metric name and provenance',
        async function (scope: TestScope) {
            const fixture = completionProcess(1, null);
            const result = await completeProcess(
                {
                    kind: 'interaction',
                    readiness: null,
                    steps: [ {
                        kind: 'interaction',
                        name: 'lookup',
                        input: 'query',
                        marker: { stream: 'stdout', text: 'answer' }
                    } ]
                },
                fixture.child,
                fixture.output
            );
            scope.assert.deepEqual({ exit: result.exit, readiness: result.readiness }, { exit: null, readiness: null });
            const reading = result.interactions['interaction.lookup.durationMicroseconds'];
            scope.require.defined(reading);
            scope.assert.partialDeepEqual(reading, {
                availability: 'available',
                provenance: { collector: 'process-interaction-v1', scope: 'process', unit: 'microseconds' }
            });
            if (reading.availability === 'available') {
                scope.assert.true(reading.value >= 0);
            }
            scope.assert.deepEqual(fixture.calls, [ 'write:query' ]);
            return scope.assert.collect();
        }
    ),
    test(
        'records successful and failed checkpoints without swallowing failures',
        async function (scope) {
            const recorded: ProcessCheckpoint[] = [];
            const failure = new Error('step failed');
            await withProcessTimeline(function (value) {
                recorded.push(value);
            }, async function () {
                scope.assert.equal(
                    await processCheckpoint('success', async function () {
                        return 42;
                    }),
                    42
                );
                await scope.assert.rejects(async function () {
                    await processCheckpoint('failure', async function () {
                        throw failure;
                    });
                }, { exact: failure });
            });
            scope.assert.deepEqual(
                recorded.map(function (value) {
                    return { name: value.name, outcome: value.outcome };
                }),
                [ { name: 'success', outcome: 'complete' }, { name: 'failure', outcome: 'failed' } ]
            );
            scope.assert.true(recorded.every(function (value) {
                return value.startMicroseconds >= 0 && value.durationMicroseconds >= 0;
            }));
            return scope.assert.collect();
        }
    ),
    test(
        'preserves results and failures when timeline recording is disabled',
        async function (scope) {
            const failure = new Error('disabled');
            scope.assert.equal(
                await withProcessTimeline(null, async function () {
                    return await processCheckpoint('value', async function () {
                        return 42;
                    });
                }),
                42
            );
            await scope.assert.rejects(async function () {
                await withProcessTimeline(null, async function () {
                    return await processCheckpoint('failure', async function () {
                        throw failure;
                    });
                });
            }, { exact: failure });
            return scope.assert.collect();
        }
    )
]);
