import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { rule, testDouble } from './test-double.ts';

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

registerTest('construction rules can call custom answers', function () {
    type ClientConstructor = new (id: string) => ClientWithId;

    const Client = testDouble<ClientConstructor>({
        rules: [
            rule.whenConstructedWith('client').calls(function createClient(...values: readonly unknown[]) {
                return { id: String(values[0]) };
            })
        ]
    });

    assert.deepEqual(Reflect.construct(Client, [ 'client' ]), { id: 'client' });
});

registerTest('construction rules can sequence answers', function () {
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

    assert.equal(Reflect.construct(Client, [ 'ignored' ]), firstClient);
    assert.equal(Reflect.construct(Client, [ 'ignored' ]), secondClient);
});

registerTest('construction rules can throw', function () {
    type ClientConstructor = new () => ClientWithId;

    const error = new Error('expected');
    const Client = testDouble<ClientConstructor>({
        rules: [ rule.onConstruction(0).throws(error) ]
    });

    assert.throws(function constructThrownClient() {
        Reflect.construct(Client, []);
    }, error);
});

registerTest('constructor doubles throw TypeError when no behavior can answer', function () {
    type ClientConstructor = new (id: string) => ClientWithId;

    const Client = testDouble<ClientConstructor>({
        rules: [ rule.whenConstructedWith('known').constructs({ id: 'known' }) ]
    });

    assert.throws(function constructUnknownClient() {
        Reflect.construct(Client, [ 'unknown' ]);
    }, /no configured behavior/u);
});

registerTest('constructor doubles reject primitive behavior answers', function () {
    type ClientConstructor = new () => ClientWithId;

    const Client = testDouble<ClientConstructor>({
        answer() {
            return 'invalid' as unknown as ClientWithId;
        }
    });

    assert.throws(function constructPrimitiveAnswer() {
        Reflect.construct(Client, []);
    }, /constructor behavior must return an object instance/u);
    assert.equal(Client.firstConstruction?.instance, null);
    assert.equal(Client.firstResult?.status, 'threw');
});

registerTest('empty history boundary accessors return null snapshots', function () {
    const loadValue = testDouble.returns('value');

    assert.equal(loadValue.firstCall, null);
    assert.equal(loadValue.firstConstruction, null);
    assert.equal(loadValue.firstInteraction, null);
    assert.equal(loadValue.firstResult, null);
    assert.equal(loadValue.lastCall, null);
    assert.equal(loadValue.lastConstruction, null);
    assert.equal(loadValue.lastInteraction, null);
    assert.equal(loadValue.lastResult, null);
});

registerTest('invalid history indexes return null snapshots', function () {
    const loadValue = testDouble.returns('value');

    assert.equal(loadValue.nthCall(-1), null);
    assert.equal(loadValue.nthCall(0.5), null);
    assert.equal(loadValue.nthConstruction(-1), null);
    assert.equal(loadValue.nthConstruction(0.5), null);
    assert.equal(loadValue.nthInteraction(-1), null);
    assert.equal(loadValue.nthInteraction(0.5), null);
});
