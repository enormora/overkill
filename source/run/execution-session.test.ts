import assert from 'node:assert/strict';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    orchestrator,
    type RunExecutionSessionOptions,
    type RunExecutionSession,
    type RunExecutionReply
} from '../packages/run/run.entry-point.ts';
import { collectedRunCommand } from '../test-support/collected-run-fixtures.ts';
import {
    createChildRun,
    nativeChildDependencies,
    readNativeEnvironment,
    type ChildRunFixture
} from '../test-support/supervised-child-fixture.ts';
import { loadRunTestModules } from './node-run-dependencies.entry-point.ts';
import { runSupervisedChild } from './supervised-child.ts';
import { createSupervisedRunCommand } from './run-isolated-command.ts';
import { policyBaselineCommand } from './frozen-run-policy.ts';

const lifecycleModule = new URL(
    '../integration-tests/run/fixtures/execution-session-lifecycle.test.ts',
    import.meta.url
);

const passingFiles = [ 'source/integration-tests/run/fixtures/passing.test.ts' ] as const;
const lifecycleCases = [ 'source/integration-tests/run/fixtures/execution-session-lifecycle.test.ts' ] as const;

async function sessionOptions(
    processModel: 'in-process' | 'supervised-process',
    files: readonly string[]
): Promise<RunExecutionSessionOptions> {
    const command = collectedRunCommand();
    const profile = command.config.profiles.microtest;
    if (profile?.testFamily !== 'microtest') {
        throw new Error('Missing microtest fixture profile.');
    }
    const policy = await orchestrator.freezePolicy({
        moduleBoundary: null,
        source: { kind: 'memory' },
        command: {
            ...command,
            config: {
                ...command.config,
                profiles: {
                    microtest: {
                        ...profile,
                        execution: { processModel, scheduling: 'serial', maxConcurrency: 1 },
                        timeouts: { collectionMilliseconds: 30_000, hardMilliseconds: 30_000, softMilliseconds: 30_000 }
                    }
                }
            },
            request: { ...command.request, paths: files }
        }
    });
    return {
        command: {
            kind: 'frozen-policy',
            policy,
            invocation: { seed: { value: 42n }, selection: { kind: 'all' } },
            reporting: { outputRenderer: command.config.outputRenderer, reporters: [] }
        },
        lifecycle: {
            moduleUrl: lifecycleModule.href,
            exportName: 'createSessionLifecycle'
        },
        environment: 'profile-default'
    };
}

async function createNativeSessionChild(data: string): Promise<ChildRunFixture> {
    const options = await sessionOptions('supervised-process', passingFiles);
    const { policy } = options.command;
    const command = createSupervisedRunCommand(
        policyBaselineCommand(policy),
        { ...policy.profile, reporters: null },
        policy.files,
        { kind: 'frozen-policy', policy }
    );
    return createChildRun({
        command: { ...command, kind: 'run-session', policy, session: { lifecycle: options.lifecycle, data } },
        assignment: {
            kind: 'assign',
            attachmentEndpoint: null,
            assignedCases: [ {
                file: passingFiles[0],
                suite: [ 'fixture' ],
                title: 'passes',
                params: null
            } ]
        },
        async discoverRunFiles() {
            return policy.files;
        },
        loadRunTestModules,
        readEnvironment: readNativeEnvironment
    });
}

function createScheduledSession(
    options: RunExecutionSessionOptions,
    scheduling: 'concurrent' | 'serial',
    maxConcurrency: number
): RunExecutionSession {
    const { policy } = options.command;
    return orchestrator.createExecutionSession({
        ...options,
        command: {
            ...options.command,
            policy: {
                ...policy,
                profile: { ...policy.profile, execution: { ...policy.profile.execution, scheduling, maxConcurrency } },
                request: { ...policy.request, execution: { mode: 'profile-default' } }
            }
        }
    });
}

function requirePassedExecution(reply: RunExecutionReply): void {
    assert.ok(reply.kind === 'result', JSON.stringify(reply));
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

export const testNode = suite('public execution session boundaries', [
    ...([ 'in-process', 'supervised-process' ] as const).map(function selectedCounts(processModel) {
        return test(`${processModel} reports the plan selected by its lifecycle`, async function (scope) {
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
        });
    }),
    ...[ 'pass', 'before' ].map(function childLifecycle(data) {
        return test(`child sessions finalize ${data} execution before reporting`, async function (scope) {
            const child = await createNativeSessionChild(data);
            await runSupervisedChild(child.host, nativeChildDependencies());
            const messages = child.messages();
            const snapshot = messages.find(function lifecycleData(message) {
                return message.kind === 'execution-data';
            });
            assert.ok(snapshot !== undefined, JSON.stringify(messages));
            assert.deepEqual(
                snapshot.data,
                data === 'pass'
                    ? [ 'select', 'snapshot', 'before', 'enter', 'complete', 'snapshot' ]
                    : [ 'select', 'snapshot', 'before', 'snapshot' ],
                JSON.stringify(messages)
            );
            scope.assert.equal(child.exitCode(), data === 'pass' ? 0 : 1, { message: JSON.stringify(messages) });
            scope.assert.equal(child.disconnected(), true);
            scope.assert.equal(
                messages.some(function passedResult(message) {
                    return message.kind === 'result' && message.result.summary.passed === 1;
                }),
                data === 'pass',
                { message: JSON.stringify(messages) }
            );
            return scope.assert.collect();
        });
    }),
    ...[
        { data: 'duplicate-data', message: 'Duplicate execution lifecycle data.' },
        { data: 'malformed-data', message: 'Invalid child-process IPC payload.' }
    ]
        .map(function invalidSessionFrames({ data, message }) {
            return test(`rejects supervised ${data} frames and permits the next invocation`, async function (scope) {
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
            });
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
    ...[ 'serial', 'concurrent' ].map(function schedulingMode(scheduling) {
        return test(`stops admission after lifecycle completion in ${scheduling} execution`, async function (scope) {
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
        });
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
    ...[ 'missingFactory', 'notALifecycleFactory', 'emptyLifecycleFactory', 'incompleteLifecycleFactory' ].map(
        function invalidFactory(exportName) {
            return test(`rejects invalid lifecycle export ${exportName}`, async function (scope) {
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
            });
        }
    ),
    ...([ 'serial', 'concurrent' ] as const).flatMap(function schedulingMode(scheduling) {
        return [ 'enter', 'complete' ].map(function failedCaseHook(data) {
            return test(`preserves case ${data} hook errors during ${scheduling} execution`, async function (scope) {
                const session = createScheduledSession(await sessionOptions('in-process', passingFiles), scheduling, 1);
                scope.cleanup(session.dispose);
                const failed = await session.run({ data, timeoutMilliseconds: 30_000, signal: null });
                scope.assert.equal(JSON.stringify(failed).includes(`Lifecycle ${data} failed.`), true);
                if (failed.kind === 'result') {
                    scope.assert.equal(failed.result.status, 'failed');
                } else {
                    scope.assert.equal(failed.kind, 'failure');
                }
                const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
                requirePassedExecution(completed);
                return scope.assert.collect();
            });
        });
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
    ...[ 'select', 'before', 'snapshot', 'dispose' ].map(function failedPhase(data) {
        return test(`preserves ${data} failures and releases invocation admission`, async function (scope) {
            const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
            scope.cleanup(session.dispose);
            const failed = await session.run({ data, timeoutMilliseconds: 30_000, signal: null });
            assert.ok(failed.kind === 'failure', JSON.stringify(failed));
            scope.assert.equal(failed.failure.message, `Lifecycle ${data} failed.`);
            const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
            scope.assert.equal(completed.kind, 'result');
            return scope.assert.collect();
        });
    }),
    ...([ 'profile-default', 'fresh-invocation', 'supervised-process' ] as const).map(function executionBoundary(mode) {
        return test(`retains execution and disposal errors through ${mode}`, async function (scope) {
            const session = await sessionAtBoundary(mode);
            scope.cleanup(session.dispose);
            const failed = await session.run({ data: 'before-and-dispose', timeoutMilliseconds: 30_000, signal: null });
            assertCombinedLifecycleFailure(scope, failed, 'Lifecycle before failed.');
            const completed = await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null });
            requirePassedExecution(completed);
            return scope.assert.collect();
        });
    }),
    test('retains disposal failures when execution is cancelled by its deadline', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
        scope.cleanup(session.dispose);
        requirePassedExecution(await session.run({ data: 'pass', timeoutMilliseconds: 30_000, signal: null }));
        const failed = await session.run({ data: 'late-select-and-dispose', timeoutMilliseconds: 5, signal: null });
        assertCombinedLifecycleFailure(scope, failed, 'Invocation deadline exceeded.');
        return scope.assert.collect();
    }),
    test('reports completed work past its deadline and preserves late infrastructure failures', async function (scope) {
        const session = orchestrator.createExecutionSession(await sessionOptions('in-process', passingFiles));
        scope.cleanup(session.dispose);
        const completed = await session.run({ data: 'late-result', timeoutMilliseconds: 1, signal: null });
        scope.assert.equal(completed.kind, 'timeout', { message: JSON.stringify(completed) });
        const failed = await session.run({ data: 'late-failure', timeoutMilliseconds: 1, signal: null });
        assert.ok(failed.kind === 'failure', JSON.stringify(failed));
        scope.assert.equal(failed.failure.message, 'Lifecycle failed after the deadline.');
        return scope.assert.collect();
    }),
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

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
