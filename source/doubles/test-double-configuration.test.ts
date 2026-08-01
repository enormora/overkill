import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type ClientWithId = {
    readonly id: string;
};
type ClientFactory = {
    (baseUrl: string): ClientWithId;
    new (baseUrl: string): ClientWithId;
};

registerTest('testDouble() rejects invalid configuration arguments', function () {
    const createDoubleFromUnknowns = testDouble as unknown as (...configuration: readonly unknown[]) => unknown;

    assert.throws(function createDoubleFromPrimitiveConfiguration() {
        createDoubleFromUnknowns(1);
    }, /requires a configuration object/u);
    assert.throws(function createDoubleFromTooManyConfigurations() {
        createDoubleFromUnknowns({}, {});
    }, /requires a configuration object/u);
});

registerTest('testDouble() ignores invalid configuration entries', function () {
    type LoadValue = () => string;

    const loadValue = testDouble<LoadValue>(
        {
            answer: 'ignored',
            fallback: 'ignored',
            rules: [ 'ignored' ]
        } as unknown as Parameters<typeof testDouble<LoadValue>>[0]
    );

    assert.throws(function loadWithoutValidBehavior() {
        loadValue();
    }, /no configured behavior/u);
});

registerTest('fallback can configure call defaults without construction defaults', function () {
    const calledClient = { id: 'called' };
    const clientFactory = testDouble<ClientFactory>(
        {
            fallback: {
                call: rule.returns(calledClient)
            }
        } as unknown as Parameters<typeof testDouble<ClientFactory>>[0]
    );

    assert.equal(clientFactory('https://api.example.test'), calledClient);
    assert.throws(function constructWithoutFallbackBehavior() {
        Reflect.construct(clientFactory, [ 'https://api.example.test' ]);
    }, /not a constructor/u);
});

registerTest('fallback can configure construction defaults without call defaults', function () {
    const constructedClient = { id: 'constructed' };
    const clientFactory = testDouble<ClientFactory>(
        {
            fallback: {
                construction: rule.constructs(constructedClient)
            }
        } as unknown as Parameters<typeof testDouble<ClientFactory>>[0]
    );

    assert.equal(Reflect.construct(clientFactory, [ 'https://api.example.test' ]), constructedClient);
    assert.throws(function callWithoutFallbackBehavior() {
        clientFactory('https://api.example.test');
    }, /Class constructor/u);
});

registerTest('fallback behaviors that cannot answer an invocation fall through', function () {
    const constructedClient = { id: 'constructed' };
    const clientFactory = testDouble<ClientFactory>({
        rules: [ rule.onConstruction(0).constructs(constructedClient) ],
        fallback: rule.returns({ id: 'called' })
    });

    assert.equal(Reflect.construct(clientFactory, [ 'https://api.example.test' ]), constructedClient);
    assert.throws(function constructWithoutMatchingBehavior() {
        Reflect.construct(clientFactory, [ 'https://api.example.test' ]);
    }, /no configured behavior/u);
});

registerTest('sequence entries that cannot answer an invocation fall through', function () {
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

    assert.throws(function constructWithCallSequenceEntry() {
        Reflect.construct(Client, []);
    }, /no configured behavior/u);
    assert.equal(Reflect.construct(Client, []).id, 'constructed');
});
