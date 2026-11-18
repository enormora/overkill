import { runIfMain } from '#test-runner';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { testDouble } from './test-double.ts';

type ConstructedClient = { readonly name: string; };

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/doubles/double-history-empty.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'valid history indexes distinguish missing records from recorded constructions',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const Client = testDouble.constructs<new (name: string) => ConstructedClient>({
                    name: 'client'
                });
                scope.assert.equal(Client.nthConstruction(0), null);
                scope.assert.equal(Client.nthInteraction(0), null);
                const result = new Client('first');
                scope.assert.equal(result.name, 'client');
                scope.assert.deepEqual<unknown, unknown>({
                    arguments: Client.nthConstruction(0)?.arguments,
                    interaction: Client.nthInteraction(0)?.kind
                }, { arguments: [ 'first' ], interaction: 'construction' });
                scope.assert.equal(Client.nthConstruction(1), null);
                scope.assert.equal(Client.nthInteraction(1), null);
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'iterator history remains empty until the first iteration',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const sequence = testDouble.yields<() => Generator<number, undefined, unknown>>([ 42 ], undefined);
                scope.assert.equal(sequence.firstIteratorEvent, null);
                const iterator = sequence();
                scope.assert.equal(sequence.firstIteratorEvent, null);
                scope.assert.deepEqual(iterator.next(), { done: false, value: 42 });
                scope.assert.partialDeepEqual({ event: sequence.firstIteratorEvent }, {
                    event: { kind: 'yield', value: 42, method: 'next' }
                });
                return scope.assert.collect();
            }
        }),

        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'empty history boundary accessors return null snapshots',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const loadValue = testDouble.returns('value');

                scope.assert.equal(loadValue.firstCall, null);
                scope.assert.equal(loadValue.firstConstruction, null);
                scope.assert.equal(loadValue.firstInteraction, null);
                scope.assert.equal(loadValue.firstResult, null);
                scope.assert.equal(loadValue.lastCall, null);
                scope.assert.equal(loadValue.lastConstruction, null);
                scope.assert.equal(loadValue.lastInteraction, null);
                scope.assert.equal(loadValue.lastResult, null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'invalid history indexes return null snapshots',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const loadValue = testDouble.returns('value');

                scope.assert.equal(loadValue.nthCall(-1), null);
                scope.assert.equal(loadValue.nthCall(0.5), null);
                scope.assert.equal(loadValue.nthConstruction(-1), null);
                scope.assert.equal(loadValue.nthConstruction(0.5), null);
                scope.assert.equal(loadValue.nthInteraction(-1), null);
                scope.assert.equal(loadValue.nthInteraction(0.5), null);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
