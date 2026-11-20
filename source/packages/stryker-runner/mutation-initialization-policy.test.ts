import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { mutationInitialization } from '../../test-support/mutation-initialization.ts';
import { runExecutionFailure } from '../run/run.entry-point.ts';
import { initializeCampaignRunner } from './mutation-runner-initialization.ts';

export const testNode = authoredSuite('mutation adapter initialization', [
    test('registers the campaign before freezing policy and creating execution', async function (scope: TestScope) {
        const fixture = await mutationInitialization([ { kind: 'registered', campaign: 'campaign' } ], null);
        const result = await initializeCampaignRunner(fixture.input, fixture.runtime);
        scope.assert.deepEqual(fixture.events, [ 'log', 'sandbox', 'exclude', 'connect', 'connected', 'execute' ]);
        scope.assert.deepEqual(
            fixture.requests.map(function (request) {
                return request.kind;
            }),
            [ 'register', 'resolve-policy' ]
        );
        scope.assert.equal(result.root, '/sandbox');
        scope.assert.partialDeepEqual<unknown, unknown>(result.diagnostics, {
            campaign: 'campaign',
            seed: '42',
            profile: 'unit',
            mode: 'off'
        });
        return scope.assert.collect();
    }),
    test('disposes the client when registration exceeds its deadline', async function (scope: TestScope) {
        const fixture = await mutationInitialization([ { kind: 'timeout', artifacts: [], data: null } ], null);
        await scope.assert.rejects(async function () {
            return await initializeCampaignRunner(fixture.input, fixture.runtime);
        }, { name: 'InvocationDeadlineExceededError' });
        scope.assert.equal(fixture.events.at(-1), 'dispose');
        scope.assert.equal(fixture.requests.length, 1);
        return scope.assert.collect();
    }),
    test('rejects invalid campaign registration responses', async function (scope: TestScope) {
        const fixture = await mutationInitialization([ { kind: 'accepted' } ], null);
        await scope.assert.rejects(async function () {
            return await initializeCampaignRunner(fixture.input, fixture.runtime);
        }, { message: 'Campaign IPC did not return campaign identity.' });
        scope.assert.equal(fixture.events.at(-1), 'dispose');
        return scope.assert.collect();
    }),
    test('disposes the client when policy resolution times out', async function (scope: TestScope) {
        const fixture = await mutationInitialization([ { kind: 'registered', campaign: 'campaign' }, {
            kind: 'timeout',
            artifacts: [],
            data: null
        } ], null);
        await scope.assert.rejects(async function () {
            return await initializeCampaignRunner(fixture.input, fixture.runtime);
        }, { name: 'InvocationDeadlineExceededError' });
        scope.assert.equal(fixture.events.at(-1), 'dispose');
        return scope.assert.collect();
    }),
    test('rejects responses that do not contain a frozen policy', async function (scope: TestScope) {
        const fixture = await mutationInitialization([ { kind: 'registered', campaign: 'campaign' }, {
            kind: 'accepted'
        } ], null);
        await scope.assert.rejects(async function () {
            return await initializeCampaignRunner(fixture.input, fixture.runtime);
        }, { message: 'Campaign IPC did not return a frozen execution policy.' });
        scope.assert.equal(fixture.events.at(-1), 'dispose');
        return scope.assert.collect();
    }),
    test('restores campaign policy failures and releases the client', async function (scope: TestScope) {
        const fixture = await mutationInitialization([ { kind: 'registered', campaign: 'campaign' }, {
            kind: 'failure',
            artifacts: [],
            data: null,
            failure: runExecutionFailure(new Error('policy failed'))
        } ], null);
        await scope.assert.rejects(async function () {
            return await initializeCampaignRunner(fixture.input, fixture.runtime);
        }, { message: 'policy failed' });
        scope.assert.equal(fixture.events.at(-1), 'dispose');
        return scope.assert.collect();
    }),
    test('does not connect when sandbox validation fails', async function (scope: TestScope) {
        const failure = new Error('sandbox failed');
        const fixture = await mutationInitialization([], failure);
        await scope.assert.rejects(async function () {
            return await initializeCampaignRunner(fixture.input, fixture.runtime);
        }, { exact: failure });
        scope.assert.deepEqual(fixture.events, [ 'log', 'sandbox' ]);
        return scope.assert.collect();
    }),
    test('validates adapter options before logging or connecting', async function (scope: TestScope) {
        const fixture = await mutationInitialization([], null);
        await scope.assert.rejects(async function () {
            return await initializeCampaignRunner(
                { ...fixture.input, options: { overkill: { seed: 'invalid' } } },
                fixture.runtime
            );
        }, { name: 'ConfigError' });
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    })
]);
