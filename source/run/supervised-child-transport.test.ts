import { runInNewContext } from 'node:vm';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createChildTransportFixture } from '../test-support/child-transport-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import { childProcessEnvelope } from './child-process-protocol.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const caseId = { file: 'fixture.test.ts', params: null, suite: [], title: 'active case' } as const;
const invalidMessages: readonly unknown[] = [
    { userMessage: 'unexpected' },
    childProcessEnvelope('supervised-run', { kind: 'event', event: { kind: 'test-start', attempt: 'invalid' } }),
    childProcessEnvelope('supervised-run', { kind: 'result', result: { status: 'passed' } })
];
function createForeignDeliveryError(): Error {
    return runInNewContext('new Error("Delivery failed.")') as Error;
}
export const testNode = createSuite({
    title: 'supervised child transport',
    ...metadata,
    children: [
        ...[ new Error('Delivery failed.'), createForeignDeliveryError() ].map(function deliveryFailure(failure) {
            return createTestCase({
                title: `delivery failure from ${
                    failure instanceof Error ? 'native' : 'foreign'
                } errors settles the child transport`,
                ...metadata,
                body(scope) {
                    const fixture = createChildTransportFixture(true);
                    fixture.deliveryFailure.write(failure);
                    fixture.emit(
                        'message',
                        childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                    );
                    fixture.emit('close', undefined);
                    scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'runtime-policy');
                    scope.assert.equal(
                        fixture.state.runnerErrors()[0]?.message,
                        failure instanceof Error ? failure.message : 'Invalid supervised child IPC payload.'
                    );
                    scope.assert.deepEqual(fixture.messages, []);
                    scope.assert.equal(fixture.outcome().finished, 1);
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            title: 'output draining retains the final completed attempt without reviving execution',
            ...metadata,
            body(scope: TestScope) {
                const state = createSupervisedRunState('first-failure-and-final');
                const result = runResultFactory
                    .build({
                        perTest: [ {
                            id: caseId,
                            workId: createDefaultWorkId(caseId)
                        } ]
                    })
                    .perTest[0];
                scope.require.defined(result);
                state.addActiveCase(
                    'final',
                    {
                        id: caseId,
                        workId: createDefaultWorkId(caseId),
                        definitionLocations: metadata.definitionLocations,
                        capture: null
                    },
                    0,
                    { index: 2 }
                );
                state.recordTestAttemptResult(
                    'final',
                    { ...result, attempts: [ { ...result.attempts[0], attempt: { index: 2 } } ] },
                    'final',
                    10
                );
                state.removeActiveCase('final');
                state.beginOutputDraining();
                state.recordCapturedOutput('stdout', Buffer.from('final output'), 20);
                scope.assert.deepEqual([
                    state.activeCases.size,
                    state.artifacts()[0]?.id.attempt?.index
                ], [ 0, 2 ]);
                return scope.assert.collect();
            }
        }),

        createTestCase({
            title: 'completed policy-violating cases remain completed after a later child crash',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.state.addActiveCase(
                    'completed',
                    {
                        id: caseId,
                        workId: createDefaultWorkId(caseId),
                        definitionLocations: metadata.definitionLocations,
                        capture: null
                    },
                    0,
                    { index: 0 }
                );
                fixture.state.recordRuntimePolicyViolation('raw-stderr', 'raw output');
                fixture.state.removeActiveCase('completed');
                fixture.state.recordTerminalActiveCases('crashed', 1000);
                scope.assert.deepEqual(
                    fixture.state.perTestResults().map(function verdict(result) {
                        return result.verdict;
                    }),
                    [ 'runtime-policy' ]
                );
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                fixture.emit('close', undefined);
                return scope.assert.collect();
            }
        }),

        createTestCase({
            title: 'a terminal IPC violation ignores subsequent transport messages and errors',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit('message', { foreign: true });
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                fixture.emit('error', new Error('error after termination'));
                fixture.emit('close', undefined);
                scope.assert.equal(fixture.state.runnerErrors().length, 1);
                scope.assert.deepEqual(fixture.messages, []);
                scope.assert.equal(fixture.outcome().finished, 1);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'parent-observed policy violations retain validated final child diagnostics',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                const result = { kind: 'result', result: runResultFactory.build() } as const;
                fixture.terminalFailure.write(true);
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', {
                        kind: 'event',
                        event: { kind: 'suite-start', suitePath: [] }
                    })
                );
                fixture.emit('message', childProcessEnvelope('supervised-run', result));
                fixture.emit('close', undefined);
                scope.assert.deepEqual(fixture.messages, [ result ]);
                scope.assert.equal(fixture.outcome().finished, 1);
                return scope.assert.collect();
            }
        }),

        createTestCase({
            title: 'disconnect without completion records a crash and observes the shutdown deadline',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit('disconnect', undefined);
                fixture.clock.advanceByMilliseconds(1000);
                scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'crash');
                scope.assert.deepEqual(fixture.outcome(), {
                    closed: 1,
                    finished: 1,
                    signals: [ 'SIGKILL', 'SIGKILL' ]
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'a completed child that never closes fails and releases the parent transport',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                fixture.clock.advanceByMilliseconds(1000);
                scope.assert.equal(
                    fixture.state.runnerErrors()[0]?.message,
                    'Supervised child shutdown exceeded one second.'
                );
                scope.assert.deepEqual(fixture.outcome(), { closed: 1, finished: 1, signals: [ 'SIGKILL' ] });
                return scope.assert.collect();
            }
        }),

        ...invalidMessages.map(function invalidMessage(message, index) {
            return createTestCase({
                title: `invalid IPC ${index} fails the run and crashes active attempts without sender attribution`,
                ...metadata,
                body(scope: TestScope) {
                    const fixture = createChildTransportFixture(true);
                    fixture.state.addActiveCase(
                        'active',
                        {
                            id: caseId,
                            workId: createDefaultWorkId(caseId),
                            definitionLocations: metadata.definitionLocations,
                            capture: null
                        },
                        0,
                        { index: 2 }
                    );
                    fixture.emit('message', message);
                    const error = fixture.state.runnerErrors()[0];
                    scope.require.defined(error);
                    scope.assert.deepEqual([
                        error.subtype,
                        error.attributedTo,
                        error.attributedToAttempt,
                        error.attributedToWork
                    ], [ 'runtime-policy', null, null, null ]);
                    scope.assert.deepEqual(
                        fixture.state.perTestResults().map(function result(test) {
                            return { verdict: test.verdict, attempt: test.attempts[0].attempt.index };
                        }),
                        [ { verdict: 'crashed', attempt: 2 } ]
                    );
                    fixture.clock.advanceByMilliseconds(1000);
                    scope.assert.deepEqual(fixture.outcome(), {
                        closed: 1,
                        finished: 1,
                        signals: [ 'SIGKILL', 'SIGKILL' ]
                    });
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            title: 'an unrestricted foreign message remains ignorable',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(false);
                fixture.emit('message', { foreign: true });
                fixture.clock.advanceByMilliseconds(1000);
                scope.assert.deepEqual(fixture.outcome(), { closed: 0, finished: 0, signals: [] });
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                fixture.emit('close', undefined);
                scope.assert.deepEqual(fixture.state.runnerErrors(), []);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'exit zero without protocol completion is a crash and waits for close',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit('exit', undefined);
                scope.assert.equal(fixture.outcome().finished, 0);
                fixture.emit('close', undefined);
                scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'crash');
                fixture.clock.advanceByMilliseconds(1000);
                scope.assert.deepEqual(fixture.outcome(), { closed: 0, finished: 1, signals: [] });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'valid completion drains until close and cancels the deadline',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                fixture.emit('exit', undefined);
                scope.assert.equal(fixture.outcome().finished, 0);
                fixture.emit('close', undefined);
                fixture.clock.advanceByMilliseconds(1000);
                scope.assert.deepEqual(fixture.state.runnerErrors(), []);
                scope.assert.deepEqual(fixture.outcome(), { closed: 0, finished: 1, signals: [] });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'IPC buffered before exit is drained before deciding completion',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit('exit', undefined);
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                fixture.emit('close', undefined);
                scope.assert.deepEqual(fixture.state.runnerErrors(), []);
                scope.assert.equal(fixture.outcome().finished, 1);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'late IPC after completion fails before transport closure',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                fixture.emit(
                    'message',
                    childProcessEnvelope('supervised-run', { kind: 'result', result: runResultFactory.build() })
                );
                scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'runtime-policy');
                scope.assert.deepEqual(fixture.outcome().signals, [ 'SIGKILL' ]);
                fixture.emit('close', undefined);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'native transport errors are crashes rather than policy violations',
            ...metadata,
            body(scope) {
                const fixture = createChildTransportFixture(true);
                fixture.emit('error', new Error('transport failed'));
                scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'crash');
                fixture.emit('close', undefined);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
