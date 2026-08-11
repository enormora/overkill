import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type ClientWithId = {
    readonly id: string;
};

export const testSuite = createOverkillSuite({
    name: 'source/doubles/test-double-construction.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'construction rules can call custom answers',
            metadata: {},
            body(scope: OverkillScope) {
                type ClientConstructor = new (id: string) => ClientWithId;

                const Client = testDouble<ClientConstructor>({
                    rules: [
                        rule.whenConstructedWith('client').calls(function createClient(...values: readonly unknown[]) {
                            return { id: String(values[0]) };
                        })
                    ]
                });

                scope.assert.deepEqual(Reflect.construct(Client, [ 'client' ]), { id: 'client' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'construction rules can sequence answers',
            metadata: {},
            body(scope: OverkillScope) {
                type ClientConstructor = new (id: string) => ClientWithId;

                const firstClient = { id: 'first' };
                const secondClient = { id: 'second' };
                const Client = testDouble<ClientConstructor>({
                    rules: [
                        rule.whenConstructedWith('ignored').sequence([
                            rule.constructs(firstClient),
                            rule.constructs(secondClient)
                        ])
                    ]
                });

                scope.assert.equal(Reflect.construct(Client, [ 'ignored' ]), firstClient);
                scope.assert.equal(Reflect.construct(Client, [ 'ignored' ]), secondClient);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'construction rules can throw',
            metadata: {},
            body(scope: OverkillScope) {
                type ClientConstructor = new () => ClientWithId;

                const error = new Error('expected');
                const Client = testDouble<ClientConstructor>({
                    rules: [ rule.onConstruction(0).throws(error) ]
                });

                scope.assert.throws(function constructThrownClient() {
                    Reflect.construct(Client, []);
                }, { exact: error });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'constructor doubles throw TypeError when no behavior can answer',
            metadata: {},
            body(scope: OverkillScope) {
                type ClientConstructor = new (id: string) => ClientWithId;

                const Client = testDouble<ClientConstructor>({
                    rules: [ rule.whenConstructedWith('known').constructs({ id: 'known' }) ]
                });

                scope.assert.throws(function constructUnknownClient() {
                    Reflect.construct(Client, [ 'unknown' ]);
                }, { message: /no configured behavior/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'constructor doubles reject primitive behavior answers',
            metadata: {},
            body(scope: OverkillScope) {
                type ClientConstructor = new () => ClientWithId;

                const Client = testDouble<ClientConstructor>({
                    answer() {
                        return 'invalid' as unknown as ClientWithId;
                    }
                });

                scope.assert.throws(function constructPrimitiveAnswer() {
                    Reflect.construct(Client, []);
                }, { message: /constructor behavior must return an object instance/u });
                scope.assert.equal(Client.firstConstruction?.instance, null);
                scope.assert.equal(Client.firstResult?.status, 'threw');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
