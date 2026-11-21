import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { mutationExecution } from '../../test-support/mutation-execution.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { createCampaignMutationExecution } from './mutation-runner-execution.ts';

const timeout = { kind: 'timeout', artifacts: [], data: null } as const;
const activationModes: readonly ('dry' | 'runtime' | 'static')[] = [ 'dry', 'runtime', 'static' ];
export const testNode = suite('mutation execution environment ownership', [
    test('creates one local execution session with frozen policy and seed', async function (scope: TestScope) {
        const fixture = await mutationExecution(scope.cleanup, scope.signal, false, timeout);
        scope.assert.equal(fixture.execution.environmentLifetime, 'reused');
        scope.assert.equal(fixture.initialized.length, 1);
        const command = fixture.initialized[0]?.command;
        scope.require.defined(command);
        scope.assert.equal(command.policy, fixture.input.policy);
        scope.assert.equal(command.invocation.seed.value, 42n);
        await fixture.execution.dispose();
        return scope.assert.collect();
    }),
    test(
        'forwards invocation data and remaining budget to the local session',
        async function (scope) {
            const fixture = await mutationExecution(scope.cleanup, scope.signal, false, timeout);
            fixture.clock.advanceByMilliseconds(10);
            scope.assert.equal(await fixture.execution.run({ value: 42 }, fixture.budget), timeout);
            scope.assert.deepEqual<unknown, unknown>(fixture.local[0]?.data, { value: 42 });
            scope.assert.equal(fixture.local[0]?.timeoutMilliseconds, 40);
            await fixture.execution.dispose();
            scope.assert.deepEqual(fixture.disposals, [ 'local' ]);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'admits lifecycle activation in a fresh worker',
        cases: activationModes,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const fixture = await mutationExecution(scope.cleanup, scope.signal, true, timeout);
            fixture.execution.admitEnvironment('runtime', false);
            fixture.execution.admitEnvironment(mode, true);
            scope.assert.equal(fixture.execution.environmentLifetime, 'fresh');
            scope.assert.deepEqual(fixture.initialized, []);
            scope.assert.equal(await fixture.execution.run(null, fixture.budget), timeout);
            await fixture.execution.dispose();
            scope.assert.deepEqual(fixture.disposals, [ 'release' ]);
            return scope.assert.collect();
        }
    }),
    test(
        'requires worker replacement before reloading a reused environment',
        async function (scope) {
            const fixture = await mutationExecution(scope.cleanup, scope.signal, false, timeout);
            fixture.execution.admitEnvironment('dry', false);
            fixture.execution.admitEnvironment('runtime', false);
            scope.assert.throws(function () {
                fixture.execution.admitEnvironment('runtime', true);
            }, { message: 'Loaded native ESM requires Stryker worker replacement for reload or static transitions.' });
            scope.assert.throws(function () {
                fixture.execution.admitEnvironment('static', false);
            }, { message: 'Loaded native ESM requires Stryker worker replacement for reload or static transitions.' });
            await fixture.execution.dispose();
            return scope.assert.collect();
        }
    ),
    test('requires replacement when leaving a loaded static environment', async function (scope) {
        const fixture = await mutationExecution(scope.cleanup, scope.signal, false, timeout);
        fixture.execution.admitEnvironment('static', false);
        scope.assert.throws(function () {
            fixture.execution.admitEnvironment('runtime', false);
        }, { type: Error });
        await fixture.execution.dispose();
        return scope.assert.collect();
    }),
    test(
        'uses campaign execution for a supervised profile even without fresh-state',
        async function (scope) {
            const fixture = await mutationExecution(scope.cleanup, scope.signal, true, timeout);
            const policy = {
                ...fixture.input.policy,
                profile: {
                    ...fixture
                        .input
                        .policy
                        .profile,
                    execution: {
                        ...fixture
                            .input
                            .policy
                            .profile
                            .execution,
                        processModel: 'supervised-process'
                    }
                }
            } as const;
            const execution = createCampaignMutationExecution(
                { ...fixture.input, freshState: false, policy },
                fixture.createSession
            );
            scope.assert.equal(execution.environmentLifetime, 'fresh');
            scope.assert.deepEqual(fixture.initialized, []);
            await execution.dispose();
            return scope.assert.collect();
        }
    ),
    test(
        'forwards successful campaign replies without starting a local environment',
        async function (scope) {
            const { reply } = mutationCoverageFixture('off');
            const fixture = await mutationExecution(scope.cleanup, scope.signal, true, reply);
            scope.assert.equal(await fixture.execution.run(null, fixture.budget), reply);
            scope.assert.deepEqual(fixture.local, []);
            await fixture.execution.dispose();
            return scope.assert.collect();
        }
    ),
    test('rejects invalid campaign execution replies', async function (scope) {
        const fixture = await mutationExecution(scope.cleanup, scope.signal, true, timeout);
        const execution = createCampaignMutationExecution({
            ...fixture.input,
            client: {
                ...fixture.input.client,
                async request() {
                    return { kind: 'accepted' };
                }
            }
        }, fixture.createSession);
        await scope.assert.rejects(async function () {
            await execution.run(null, fixture.budget);
        }, { message: 'Campaign IPC returned an invalid execution reply.' });
        await execution.dispose();
        return scope.assert.collect();
    }),
    test('does not invoke or release a cancelled campaign connection', async function (scope) {
        const fixture = await mutationExecution(scope.cleanup, scope.signal, true, timeout);
        const execution = createCampaignMutationExecution({
            ...fixture.input,
            signal: AbortSignal.abort(new Error('Cancelled.'))
        }, fixture.createSession);
        await scope.assert.rejects(async function () {
            await execution.run(null, fixture.budget);
        }, { message: 'Cancelled.' });
        await execution.dispose();
        scope.assert.deepEqual(fixture.disposals, []);
        return scope.assert.collect();
    })
]);
