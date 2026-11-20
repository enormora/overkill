import assert from 'node:assert/strict';
import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';
import {
    sessionOptions,
    createNativeSessionChild,
    createScheduledSession,
    passingFiles
} from '../support/execution-session.ts';

import {
    orchestrator,
    type RunExecutionSession,
    type RunExecutionReply
} from '../../../packages/run/run.entry-point.ts';
import { nativeChildDependencies } from '../../../test-support/supervised-child-fixture.ts';
import { runSupervisedChild } from '../../../run/supervised-child.ts';

const lifecycleCases = [ 'source/integration-tests/integration/fixtures/execution-session-lifecycle.test.ts' ] as const;

function requirePassedExecution(reply: RunExecutionReply): void {
    assert.ok(reply.kind === 'result', JSON.stringify(reply));
    assert.equal(Object.hasOwn(reply.result, 'maintenanceDiagnostics'), false);
    assert.equal(Object.hasOwn(reply.result, 'context'), false);
    assert.equal(reply.result.status, 'passed', JSON.stringify(reply));
}

async function sessionAtBoundary(
    mode: 'fresh-invocation' | 'profile-default' | 'supervised-process'
): Promise<RunExecutionSession> {
    const options = await sessionOptions(
        mode === 'supervised-process' ? 'supervised-process' : 'in-process',
        passingFiles
    );
    return orchestrator.createExecutionSession({
        ...options,
        environment: mode === 'fresh-invocation' ? mode : 'profile-default'
    });
}

function combinedFailureDetails(reply: RunExecutionReply): unknown {
    if (reply.kind === 'failure') {
        assert.deepEqual({ name: reply.failure.name, message: reply.failure.message }, {
            name: 'AggregateError',
            message: 'Execution and lifecycle disposal failed.'
        });
        return reply.failure.cause;
    }
    assert.ok(reply.kind === 'result', JSON.stringify(reply));
    assert.equal(reply.result.status, 'failed');
    assert.equal(reply.result.runnerErrors.length, 1);
    const error = reply.result.runnerErrors[0];
    assert.ok(error !== undefined);
    assert.equal(error.message, 'Execution and lifecycle disposal failed.');
    return error.cause;
}

function diagnosticMessage(error: unknown): string {
    assert.ok(typeof error === 'object' && error !== null);
    const message: unknown = Reflect.get(error, 'message');
    assert.ok(typeof message === 'string');
    return message;
}

function assertCombinedLifecycleFailure(scope: TestScope, reply: RunExecutionReply, executionMessage: string): void {
    const details = combinedFailureDetails(reply);
    assert.ok(typeof details === 'object' && details !== null);
    const errors: unknown = Reflect.get(details, 'errors');
    assert.ok(Array.isArray(errors));
    scope.assert.deepEqual(errors.map(diagnosticMessage), [ executionMessage, 'Lifecycle dispose failed.' ]);
    scope.assert.equal(diagnosticMessage(Reflect.get(details, 'cause')), executionMessage);
}

export const testNode: TestNode = suite('public execution session boundaries', [
    table({
        title: 'reports the plan selected by its lifecycle',
        cases: [ 'in-process', 'supervised-process' ] as const,
        caseTitle(processModel) {
            return processModel;
        },
        async test(scope) {
            const processModel = scope.parameters;

            const session = orchestrator.createExecutionSession(
                await sessionOptions(processModel, [
                    ...passingFiles,
                    ...lifecycleCases
                ])
            );
            scope.cleanup(session.dispose);
            const reply = await session.run({ data: 'narrow', timeoutMilliseconds: 30_000, signal: null });
            assert.ok(reply.kind === 'result', JSON.stringify(reply));
            scope.assert.equal(reply.result.summary.discovered, 3);
            scope.assert.equal(reply.result.summary.planned, 1);
            scope.assert.equal(reply.result.perTest.length, 1);
            scope.assert.equal(reply.result.bySuite.fixture?.planned, 1);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'finalizes child execution before reporting',
        cases: [ 'pass', 'before' ],
        caseTitle(data) {
            return data;
        },
        async test(scope) {
            const child = await createNativeSessionChild(scope.parameters);
            await runSupervisedChild(child.host, nativeChildDependencies());
            const messages = child.messages();
            const snapshot = messages.find(function lifecycleData(message) {
                return message.kind === 'execution-data';
            });
            assert.ok(snapshot !== undefined, JSON.stringify(messages));
            assert.deepEqual(
                snapshot.data,
                scope.parameters === 'pass'
                    ? [ 'select', 'snapshot', 'before', 'enter', 'complete', 'snapshot' ]
                    : [ 'select', 'snapshot', 'before', 'snapshot' ],
                JSON.stringify(messages)
            );
            scope.assert.equal(child.exitCode(), scope.parameters === 'pass' ? 0 : 1, {
                message: JSON.stringify(messages)
            });
            scope.assert.equal(child.disconnected(), true);
            scope.assert.equal(
                messages.some(function passedResult(message) {
                    return message.kind === 'result' && message.result.summary.passed === 1;
                }),
                scope.parameters === 'pass',
                { message: JSON.stringify(messages) }
            );
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid supervised frames and permits the next invocation',
        cases: [
            { data: 'duplicate-data', message: 'Duplicate execution lifecycle data.' },
            { data: 'malformed-data', message: 'Invalid child-process IPC payload.' }
        ],
        caseTitle({ data }) {
            return data;
        },
        async test(scope) {
            const { data, message } = scope.parameters;

            const session = orchestrator.createExecutionSession(
                await sessionOptions('supervised-process', passingFiles)
            );
            scope.cleanup(session.dispose);
            const failed = await session.run({ data, timeoutMilliseconds: 30_000, signal: null });
            assert.ok(failed.kind === 'failure', JSON.stringify(failed));
            scope.assert.equal(failed.failure.message, message);
            const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
            assert.ok(completed.kind === 'result', JSON.stringify(completed));
            scope.assert.equal(completed.result.status, 'passed', { message: JSON.stringify(completed) });
            return scope.assert.collect();
        }
    }),
    test('rejects malformed fresh-host results and permits the next invocation', async function (scope) {
        const options = await sessionOptions('in-process', passingFiles);
        const session = orchestrator.createExecutionSession({ ...options, environment: 'fresh-invocation' });
        scope.cleanup(session.dispose);
        const failed = await session.run({ data: 'invalid-host-reply', timeoutMilliseconds: 30_000, signal: null });
        assert.ok(failed.kind === 'failure', JSON.stringify(failed));
        scope.assert.equal(failed.failure.name, 'ZodError');
        const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
        assert.ok(completed.kind === 'result', JSON.stringify(completed));
        scope.assert.equal(completed.result.status, 'passed', { message: JSON.stringify(completed) });
        return scope.assert.collect();
    }),
    test('reports supervised exits before lifecycle data arrives', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('supervised-process', passingFiles));
        scope.cleanup(session.dispose);
        const failed = await session.run({ data: 'exit-before-data', timeoutMilliseconds: 30_000, signal: null });
        assert.ok(failed.kind === 'failure', JSON.stringify(failed));
        scope.assert.equal(failed.failure.message.startsWith('Execution lifecycle data was not delivered.'), true);
        const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
        assert.ok(completed.kind === 'result', JSON.stringify(completed));
        scope.assert.equal(completed.result.status, 'passed', { message: JSON.stringify(completed) });
        return scope.assert.collect();
    }),
    table({
        title: 'stops admission after lifecycle completion',
        cases: [ 'serial', 'concurrent' ],
        caseTitle(scheduling) {
            return scheduling;
        },
        async test(scope) {
            const scheduling = scope.parameters;

            const session = createScheduledSession(
                await sessionOptions('in-process', lifecycleCases),
                scheduling === 'serial' ? 'serial' : 'concurrent',
                1
            );
            scope.cleanup(session.dispose);
            for (const data of [ 'pass', 'stop' ]) {
                const reply = await session.run({ data, timeoutMilliseconds: 30_000, signal: null });
                assert.ok(reply.kind === 'result', JSON.stringify(reply));
                scope.assert.equal(reply.result.status, 'passed');
                scope.assert.equal(reply.result.summary.passed, data === 'stop' ? 1 : 2);
            }
            return scope.assert.collect();
        }
    }),
    test('rejects persisted coverage and baseline updates', async function (scope) {
        const options = await sessionOptions('in-process', passingFiles);
        const requests = [
            { ...options.command.policy.request, coverage: true },
            { ...options.command.policy.request, baselineUpdateMode: 'bootstrap' as const }
        ];
        for (const request of requests) {
            scope.assert.throws(function rejectPersistence() {
                return orchestrator.createExecutionSession({
                    ...options,
                    command: { ...options.command, policy: { ...options.command.policy, request } }
                });
            }, { message: 'Memory execution sessions do not support recorded coverage or baseline updates.' });
        }
        return scope.assert.collect();
    }),
    test('rejects persisted debug recording in memory sessions', async function (scope) {
        const options = await sessionOptions('in-process', passingFiles);
        const request = { ...options.command.policy.request, debug: { mode: 'all', selectors: [] } } as const;
        scope.assert.throws(function rejectDebug() {
            return orchestrator.createExecutionSession({
                ...options,
                command: { ...options.command, policy: { ...options.command.policy, request } }
            });
        }, { message: 'Memory execution sessions do not support persisted debug recording.' });
        return scope.assert.collect();
    }),
    test('resolves omitted seed values before execution', async function (scope) {
        const options = await sessionOptions('in-process', passingFiles);
        const session = orchestrator.createExecutionSession({
            ...options,
            command: { ...options.command, invocation: { ...options.command.invocation, seed: { value: null } } }
        });
        scope.cleanup(session.dispose);
        const reply = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
        assert.ok(reply.kind === 'result', JSON.stringify(reply));
        scope.assert.equal(reply.result.status, 'passed');
        return scope.assert.collect();
    }),
    test('preserves lifecycle order across repeated invocations', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
        scope.cleanup(session.dispose);
        for (const data of [ 'pass', 'pass' ]) {
            const reply = await session.run({ data, timeoutMilliseconds: 30_000, signal: null });
            assert.ok(reply.kind === 'result', JSON.stringify(reply));
            scope.assert.equal(reply.result.status, 'passed');
            scope.assert.equal(reply.result.summary.passed, 1);
            assert.deepEqual(reply.data, [ 'select', 'snapshot', 'before', 'enter', 'complete', 'snapshot' ]);
        }
        scope.assert.equal(session.environmentLifetime, 'reused');
        return scope.assert.collect();
    }),
    test('rejects concurrent and disposed invocations', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
        scope.cleanup(session.dispose);
        const invocation = { data: 'pass', timeoutMilliseconds: 30_000, signal: null };
        const active = session.run(invocation);
        await scope.assert.rejects(async function overlap() {
            await session.run(invocation);
        }, { message: 'An execution invocation is already running.' });
        const completed = await active;
        scope.assert.equal(completed.kind, 'result');
        await session.dispose();
        await scope.assert.rejects(async function afterDisposal() {
            await session.run(invocation);
        }, { message: 'Execution session has been disposed.' });
        return scope.assert.collect();
    }),
    test('returns expired budgets before loading the lifecycle', async function (scope) {
        const options = await sessionOptions('in-process', passingFiles);
        const session = orchestrator.createExecutionSession({
            ...options,
            lifecycle: { ...options.lifecycle, exportName: 'missingFactory' }
        });
        scope.cleanup(session.dispose);
        for (const timeoutMilliseconds of [ 0, -1, Number.NaN, Number.POSITIVE_INFINITY ]) {
            scope.assert.deepEqual(await session.run({ data: null, timeoutMilliseconds, signal: null }), {
                artifacts: [],
                kind: 'timeout',
                data: null
            });
        }
        return scope.assert.collect();
    }),
    test('preserves cancellation reasons before execution', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
        scope.cleanup(session.dispose);
        const reason = new Error('Canceled by the caller.');
        const reply = await session.run({
            data: 'pass',
            timeoutMilliseconds: 30_000,
            signal: AbortSignal.abort(reason)
        });
        assert.ok(reply.kind === 'failure', JSON.stringify(reply));
        scope.assert.equal(reply.failure.message, reason.message);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid lifecycle exports',
        cases: [ 'missingFactory', 'notALifecycleFactory', 'emptyLifecycleFactory', 'incompleteLifecycleFactory' ],
        caseTitle(exportName) {
            return exportName;
        },
        async test(scope) {
            const exportName = scope.parameters;

            const options = await sessionOptions('in-process', passingFiles);
            const session = orchestrator.createExecutionSession({
                ...options,
                lifecycle: { ...options.lifecycle, exportName }
            });
            scope.cleanup(session.dispose);
            const reply = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
            assert.ok(reply.kind === 'failure', JSON.stringify(reply));
            scope.assert.equal(reply.failure.name, 'TypeError');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'preserves case hook errors during execution',
        cases: ([ 'serial', 'concurrent' ] as const).flatMap(function schedulingMode(scheduling) {
            return [ 'enter', 'complete' ].map(function failedCaseHook(data) {
                return { scheduling, data };
            });
        }),
        caseTitle({ scheduling, data }) {
            return [ data, scheduling ].map(String).join(', ');
        },
        async test(scope) {
            const session = createScheduledSession(
                await sessionOptions('in-process', passingFiles),
                scope.parameters.scheduling,
                1
            );
            scope.cleanup(session.dispose);
            const failed = await session.run({
                data: scope.parameters.data,
                timeoutMilliseconds: 30_000,
                signal: null
            });
            scope.assert.equal(JSON.stringify(failed).includes(`Lifecycle ${scope.parameters.data} failed.`), true);
            if (failed.kind === 'result') {
                scope.assert.equal(failed.result.status, 'failed');
            } else {
                scope.assert.equal(failed.kind, 'failure');
            }
            const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
            requirePassedExecution(completed);
            return scope.assert.collect();
        }
    }),
    test('applies lifecycle callbacks during concurrent execution', async function (scope) {
        const session = createScheduledSession(await sessionOptions('in-process', passingFiles), 'concurrent', 2);
        scope.cleanup(session.dispose);
        const reply = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
        assert.ok(reply.kind === 'result', JSON.stringify(reply));
        scope.assert.equal(reply.result.status, 'passed');
        assert.deepEqual(reply.data, [ 'select', 'snapshot', 'before', 'enter', 'complete', 'snapshot' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'preserves failures and releases invocation admission',
        cases: [ 'select', 'before', 'snapshot', 'dispose' ],
        caseTitle(data) {
            return data;
        },
        async test(scope) {
            const data = scope.parameters;

            const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
            scope.cleanup(session.dispose);
            const failed = await session.run({ data, timeoutMilliseconds: 30_000, signal: null });
            assert.ok(failed.kind === 'failure', JSON.stringify(failed));
            scope.assert.equal(failed.failure.message, `Lifecycle ${data} failed.`);
            const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
            scope.assert.equal(completed.kind, 'result');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'retains execution and disposal errors',
        cases: [ 'profile-default', 'fresh-invocation', 'supervised-process' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const session = await sessionAtBoundary(mode);
            scope.cleanup(session.dispose);
            const failed = await session.run({ data: 'before-and-dispose', timeoutMilliseconds: 30_000, signal: null });
            assertCombinedLifecycleFailure(scope, failed, 'Lifecycle before failed.');
            const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
            requirePassedExecution(completed);
            return scope.assert.collect();
        }
    }),
    test('retains disposal failures when execution is cancelled by its deadline', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
        scope.cleanup(session.dispose);
        requirePassedExecution(await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null }));
        const failed = await session.run({ data: 'late-select-and-dispose', timeoutMilliseconds: 5, signal: null });
        assertCombinedLifecycleFailure(scope, failed, 'Invocation deadline exceeded.');
        return scope.assert.collect();
    }),
    test(
        'reports completed work past its deadline and preserves late infrastructure failures',
        async function (scope) {
            const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
            scope.cleanup(session.dispose);
            const completed = await session.run({ data: 'late-result', timeoutMilliseconds: 1, signal: null });
            scope.assert.equal(completed.kind, 'timeout', { message: JSON.stringify(completed) });
            const failed = await session.run({ data: 'late-failure', timeoutMilliseconds: 1, signal: null });
            assert.ok(failed.kind === 'failure', JSON.stringify(failed));
            scope.assert.equal(failed.failure.message, 'Lifecycle failed after the deadline.');
            return scope.assert.collect();
        }
    ),
    test('terminates supervised execution when its invocation deadline expires', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('supervised-process', passingFiles));
        scope.cleanup(session.dispose);
        scope.assert.equal(session.environmentLifetime, 'fresh');
        const expired = await session.run({ data: 'pass', timeoutMilliseconds: 1, signal: null });
        scope.assert.equal(expired.kind, 'timeout');
        const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
        assert.ok(completed.kind === 'result', JSON.stringify(completed));
        scope.assert.equal(completed.result.status, 'passed', { message: JSON.stringify(completed) });
        return scope.assert.collect();
    })
]);
