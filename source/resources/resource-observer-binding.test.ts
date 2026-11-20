import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { resourceObserverBinding } from '../test-support/resource-observer-binding.ts';
import { defineResource } from './resources.ts';
import { withResourceChecks } from './resource-checks.ts';
import { resourceImplementationParticipants } from './resource-implementation-participants.ts';

export const testNode = authoredSuite('resource observer reference admission', [
    test('admits the observer and forwards its prepared input', async function (scope: TestScope) {
        const fixture = await resourceObserverBinding(scope);
        const activation = fixture.participant.bind(
            fixture.admission.namespace,
            fixture.admission.facts,
            fixture.admission.context
        );
        const actual = await activation.run(async function () {
            return await fixture.observer(fixture.context);
        });
        scope.assert.equal(actual, fixture.observation);
        scope.assert.deepEqual(fixture.inputs, [ { prefix: 'file:///resource' } ]);
        return scope.assert.collect();
    }),
    test('rejects installation outside the admitted scope', async function (scope: TestScope) {
        const fixture = await resourceObserverBinding(scope);
        await scope.assert.rejects(async function () {
            return await fixture.observer(fixture.context);
        }, { message: 'Resource observer implementation was not admitted.' });
        const activation = fixture.participant.bind(
            fixture.admission.namespace,
            fixture.admission.facts,
            fixture.admission.context
        );
        await activation.run(async function () {
            await fixture.observer(fixture.context);
        });
        await scope.assert.rejects(async function () {
            return await fixture.observer(fixture.context);
        }, { message: 'Resource observer implementation was not admitted.' });
        return scope.assert.collect();
    }),
    test('rejects changed observer inputs before installation', async function (scope: TestScope) {
        const fixture = await resourceObserverBinding(scope);
        scope.assert.throws(function () {
            return fixture.participant.bind(
                fixture.admission.namespace,
                { ...fixture.admission.facts, input: null },
                fixture.admission.context
            );
        }, { message: 'Observer inputs changed; prepare and collect a new run.' });
        scope.assert.deepEqual(fixture.inputs, []);
        return scope.assert.collect();
    }),
    test('rejects observer exports that are not callable', async function (scope: TestScope) {
        const fixture = await resourceObserverBinding(scope);
        scope.assert.throws(function () {
            return fixture.participant.bind(
                { resource: { version: '1', implementation: 42 } },
                fixture.admission.facts,
                fixture.admission.context
            );
        }, { message: /Invalid input/u });
        return scope.assert.collect();
    }),
    test('attaches observer admission to inline resource participants', async function (scope: TestScope) {
        const fixture = await resourceObserverBinding(scope);
        const resource = withResourceChecks(
            defineResource({
                name: 'registry',
                scope: 'per-case',
                requirements: [],
                acquire() {
                    return 42;
                },
                dispose: null
            }),
            fixture.observer
        );
        const participant = resourceImplementationParticipants({ resource })[0];
        scope.require.defined(participant);
        scope.assert.equal(participant.role, 'observer');
        scope.assert.equal(participant.scope, 'per-case');
        const activation = participant.bind(
            fixture.admission.namespace,
            fixture.admission.facts,
            fixture.admission.context
        );
        scope.assert.equal(
            await activation.run(async function () {
                return await fixture.observer(fixture.context);
            }),
            fixture.observation
        );
        return scope.assert.collect();
    })
]);
