import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { processPolicyObservation } from '../test-support/process-policy-observation.ts';

export const testNode: TestNode = suite('process boundary policy observation', [
    test('reports foreign IPC listeners and releases only its own observation', function (scope) {
        const fixture = processPolicyObservation(null, false);
        fixture.events.on('message', fixture.owned);
        fixture.events.on('unrelated', fixture.owned);
        fixture.events.on('message', function () {
            return undefined;
        });
        scope.assert.deepEqual(fixture.messages, [
            'Runtime policy violation: process message listener was registered.'
        ]);
        fixture.stopIpc();
        fixture.events.on('message', function () {
            return undefined;
        });
        scope.assert.deepEqual({
            observers: fixture.events.listenerCount('newListener'),
            listeners: fixture.events.listenerCount('message'),
            messages: fixture.messages.length
        }, { observers: 0, listeners: 3, messages: 1 });
        fixture.stopExit();
        return scope.assert.collect();
    }),
    table({
        title: 'attributes process exits',
        cases: ([ 0, 1 ] as const).flatMap(function (code) {
            return [ false, true ].map(function (attributed) {
                return { code, attributed };
            });
        }),
        caseTitle({ code, attributed }) {
            return [ code, attributed ].map(String).join(', ');
        },
        test(scope) {
            const { code, attributed } = scope.parameters;

            const fixture = processPolicyObservation(null, attributed);
            fixture.events.emit('exit', code);
            scope.assert.equal(fixture.failed(), code === 0);
            scope.assert.deepEqual(fixture.writes, [
                `Observed failure.${attributed ? ' Case: active case. Attempt: 2.' : ''}\n`
            ]);
            fixture.stopExit();
            scope.assert.equal(fixture.events.listenerCount('exit'), 0);
            fixture.stopIpc();
            return scope.assert.collect();
        }
    }),
    test('contains observer failures during IPC registration and process exit', function (scope) {
        const fixture = processPolicyObservation(new Error('Reporter failed.'), false);
        fixture.events.on('message', fixture.owned);
        fixture.events.on('message', function () {
            return undefined;
        });
        fixture.events.emit('exit', 0);
        scope.assert.true(fixture.failed());
        scope.assert.deepEqual(fixture.writes, []);
        fixture.stopExit();
        fixture.stopIpc();
        return scope.assert.collect();
    })
]);
