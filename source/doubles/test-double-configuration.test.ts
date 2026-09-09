import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type ClientWithId = {
    readonly id: string;
};
type ClientFactory = {
    (baseUrl: string): ClientWithId;
    new (baseUrl: string): ClientWithId;
};

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/doubles/test-double-configuration.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'testDouble() rejects invalid configuration arguments',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const createDoubleFromUnknowns = testDouble as unknown as (
                    ...configuration: readonly unknown[]
                ) => unknown;

                scope.assert.throws(function createDoubleFromPrimitiveConfiguration() {
                    createDoubleFromUnknowns(1);
                }, { message: /requires a configuration object/u });
                scope.assert.throws(function createDoubleFromTooManyConfigurations() {
                    createDoubleFromUnknowns({}, {});
                }, { message: /requires a configuration object/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'testDouble() ignores invalid configuration entries',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                type LoadValue = () => string;

                const loadValue = testDouble<LoadValue>(
                    {
                        answer: 'ignored',
                        fallback: 'ignored',
                        rules: [ 'ignored' ]
                    } as unknown as Parameters<typeof testDouble<LoadValue>>[0]
                );

                scope.assert.throws(function loadWithoutValidBehavior() {
                    loadValue();
                }, { message: /no configured behavior/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'fallback can configure call defaults without construction defaults',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const calledClient = { id: 'called' };
                const clientFactory = testDouble<ClientFactory>(
                    {
                        fallback: {
                            call: rule.returns(calledClient)
                        }
                    } as unknown as Parameters<typeof testDouble<ClientFactory>>[0]
                );

                scope.assert.equal(clientFactory('https://api.example.test'), calledClient);
                scope.assert.throws(function constructWithoutFallbackBehavior() {
                    Reflect.construct(clientFactory, [ 'https://api.example.test' ]);
                }, { message: /not a constructor/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'fallback can configure construction defaults without call defaults',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const constructedClient = { id: 'constructed' };
                const clientFactory = testDouble<ClientFactory>(
                    {
                        fallback: {
                            construction: rule.constructs(constructedClient)
                        }
                    } as unknown as Parameters<typeof testDouble<ClientFactory>>[0]
                );

                scope.assert.equal(Reflect.construct(clientFactory, [ 'https://api.example.test' ]), constructedClient);
                scope.assert.throws(function callWithoutFallbackBehavior() {
                    clientFactory('https://api.example.test');
                }, { message: /Class constructor/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'fallback behaviors that cannot answer an invocation fall through',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const constructedClient = { id: 'constructed' };
                const clientFactory = testDouble<ClientFactory>({
                    rules: [ rule.onConstruction(0).constructs(constructedClient) ],
                    fallback: rule.returns({ id: 'called' })
                });

                scope.assert.equal(Reflect.construct(clientFactory, [ 'https://api.example.test' ]), constructedClient);
                scope.assert.throws(function constructWithoutMatchingBehavior() {
                    Reflect.construct(clientFactory, [ 'https://api.example.test' ]);
                }, { message: /no configured behavior/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'sequence entries that cannot answer an invocation fall through',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                type ClientConstructor = new () => ClientWithId;

                const Client = testDouble<ClientConstructor>(
                    {
                        fallback: rule.sequence(
                            [
                                rule.returns({ id: 'called' }),
                                rule.constructs({ id: 'constructed' })
                            ] as unknown as readonly [unknown, unknown]
                        )
                    } as unknown as Parameters<typeof testDouble<ClientConstructor>>[0]
                );

                scope.assert.throws(function constructWithCallSequenceEntry() {
                    Reflect.construct(Client, []);
                }, { message: /no configured behavior/u });
                scope.assert.equal(Reflect.construct(Client, []).id, 'constructed');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
