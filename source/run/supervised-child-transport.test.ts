import { runInNewContext } from 'node:vm';
import { table, type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import { createChildTransportFixture } from '../test-support/child-transport-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import { childProcessEnvelope } from './child-process-protocol.ts';

const metadata = { definitionLocations: [ { kind: 'unknown' } ] } as const;
const caseId = { file: 'fixture.test.ts', params: null, suite: [], title: 'active case' } as const;
function createForeignDeliveryError(): Error {
    return runInNewContext('new Error("Delivery failed.")') as Error;
}
export const testNode: TestNode = suite('supervised child transport', [
    table({
        title: 'delivery failure from errors settles the child transport',
        cases: [ new Error('Delivery failed.'), createForeignDeliveryError() ],
        caseTitle(failure) {
            return failure instanceof Error ? 'native' : 'foreign';
        },
        test(scope) {
            const failure = scope.parameters;

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
    }),
    test(
        'output draining retains the final completed attempt without reviving execution',
        function (scope: TestScope) {
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
    ),

    test('completed policy-violating cases remain completed after a later child crash', function (scope) {
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
    }),

    test('a terminal IPC violation ignores subsequent transport messages and errors', function (scope) {
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
    }),
    test('parent-observed policy violations retain validated final child diagnostics', function (scope) {
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
    }),

    test(
        'disconnect without completion records a crash and observes the shutdown deadline',
        function (scope) {
            const fixture = createChildTransportFixture(true);
            fixture.emit('disconnect', undefined);
            fixture.clock.advanceByMilliseconds(1000);
            fixture.clock.advanceByMilliseconds(1000);
            scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'crash');
            scope.assert.deepEqual(fixture.outcome(), {
                closed: 1,
                finished: 1,
                signals: [ 'SIGKILL', 'SIGKILL' ]
            });
            return scope.assert.collect();
        }
    ),
    test('a completed child that never closes fails and bounds termination waiting', function (scope) {
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
        scope.assert.deepEqual(fixture.outcome(), { closed: 1, finished: 0, signals: [ 'SIGKILL' ] });
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.equal(fixture.outcome().finished, 1);
        return scope.assert.collect();
    }),

    table({
        title: 'invalid IPC fails the run and crashes active attempts without sender attribution',
        cases: [ { description: 'foreign payload', input: { userMessage: 'unexpected' } }, {
            description: 'malformed test start',
            input: childProcessEnvelope('supervised-run', {
                kind: 'event',
                event: { kind: 'test-start', attempt: 'invalid' }
            })
        }, {
            description: 'incomplete run result',
            input: childProcessEnvelope('supervised-run', { kind: 'result', result: { status: 'passed' } })
        } ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
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
            fixture.emit('message', scope.parameters.input);
            scope.assert.deepEqual({
                errors: fixture.state.runnerErrors().map(function details(error) {
                    return [ error.subtype, error.attributedTo, error.attributedToAttempt, error.attributedToWork ];
                }),
                cases: fixture.state.perTestResults().map(function result(testResult) {
                    return { verdict: testResult.verdict, attempt: testResult.attempts[0].attempt.index };
                })
            }, {
                errors: [ [ 'runtime-policy', null, null, null ] ],
                cases: [ { verdict: 'crashed', attempt: 2 } ]
            });
            fixture.clock.advanceByMilliseconds(1000);
            fixture.clock.advanceByMilliseconds(1000);
            scope.assert.deepEqual(fixture.outcome(), {
                closed: 1,
                finished: 1,
                signals: [ 'SIGKILL', 'SIGKILL' ]
            });
            return scope.assert.collect();
        }
    }),
    test('an unrestricted foreign message remains ignorable', function (scope) {
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
    }),
    test('exit zero without protocol completion is a crash and waits for close', function (scope) {
        const fixture = createChildTransportFixture(true);
        fixture.emit('exit', undefined);
        scope.assert.equal(fixture.outcome().finished, 0);
        fixture.emit('close', undefined);
        scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'crash');
        fixture.clock.advanceByMilliseconds(1000);
        scope.assert.deepEqual(fixture.outcome(), { closed: 0, finished: 1, signals: [] });
        return scope.assert.collect();
    }),
    test('valid completion drains until close and cancels the deadline', function (scope) {
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
    }),
    test('IPC buffered before exit is drained before deciding completion', function (scope) {
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
    }),
    test('late IPC after completion fails before transport closure', function (scope) {
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
    }),
    test('native transport errors are crashes rather than policy violations', function (scope) {
        const fixture = createChildTransportFixture(true);
        fixture.emit('error', new Error('transport failed'));
        scope.assert.equal(fixture.state.runnerErrors()[0]?.subtype, 'crash');
        fixture.emit('close', undefined);
        return scope.assert.collect();
    })
]);
