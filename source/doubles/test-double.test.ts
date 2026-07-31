import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { rule, testDouble } from './test-double.ts';

type PrimitiveConstructionFactory = (instance: unknown) => unknown;
type User = {
    readonly id: string;
};
type UserQuery = {
    readonly id: string;
    readonly profile: UserProfile;
};
type UserProfile = {
    readonly role: string;
};
type ClientWithId = {
    readonly id: string;
};
type ClientOptions = {
    readonly auth: ClientAuth;
    readonly baseUrl: string;
};
type ClientAuth = {
    readonly token: string;
};

registerTest('testDouble() creates an untyped callable double', function () {
    const anyValue = testDouble();

    assert.equal(anyValue('ignored'), undefined);
});

registerTest('testDouble.returns() creates a fixed-return double', function () {
    const loadValue = testDouble.returns(42);

    assert.equal(loadValue('ignored'), 42);
});

registerTest('testDouble.resolves() creates a fixed-resolution double', async function () {
    const loadValue = testDouble.resolves('value');

    assert.equal(await loadValue('ignored'), 'value');
});

registerTest('testDouble.rejects() creates a fixed-rejection double', async function () {
    const error = new Error('expected');
    const loadValue = testDouble.rejects(error);

    await assert.rejects(async function rejectValue() {
        await loadValue('ignored');
    }, error);
});

registerTest('testDouble.throws() creates a fixed-throw double', function () {
    const error = new Error('expected');
    const loadValue = testDouble.throws(error);

    assert.throws(function throwValue() {
        loadValue('ignored');
    }, error);
});

registerTest('testDouble.constructs() creates a fixed-construction double', function () {
    type ClientInstance = {
        readonly id: string;
    };

    const client: ClientInstance = { id: 'client' };
    const Client = testDouble.constructs(client);

    assert.equal(new Client('ignored'), client);
});

registerTest('created doubles reject wrong invocation modes', function () {
    const loadValue = testDouble.returns('value');
    const Client = testDouble.constructs({ id: 'client' });
    const LoadValue = loadValue as unknown as new () => unknown;

    assert.throws(function constructCallableDouble() {
        assert.equal(new LoadValue(), undefined);
    }, /not a constructor/u);
    assert.throws(function callConstructorDouble() {
        (Client as unknown as () => unknown)();
    }, /Class constructor/u);
});

registerTest('testDouble.constructs() rejects primitive instances at runtime', function () {
    const createConstructorDouble = testDouble.constructs as unknown as PrimitiveConstructionFactory;

    assert.throws(function constructPrimitive() {
        createConstructorDouble(1);
    }, /requires an object instance/u);
});

registerTest('rule.when() matches partial-deep argument prefixes', function () {
    type LoadUser = (query: UserQuery, scope: string) => User;

    const adminUser = { id: 'admin' };
    const guestUser = { id: 'guest' };
    const loadUser = testDouble<LoadUser>({
        rules: [
            rule.when({ id: 'admin' }).returns(adminUser),
            rule.when({ profile: { role: 'guest' } }, 'read').returns(guestUser)
        ]
    });

    assert.equal(loadUser({ id: 'admin', profile: { role: 'owner' } }, 'write'), adminUser);
    assert.equal(loadUser({ id: 'guest-id', profile: { role: 'guest' } }, 'read'), guestUser);
});

registerTest('rule.whenConstructedWith() matches partial-deep constructor argument prefixes', function () {
    type ClientConstructor = new (options: ClientOptions, retries: number) => ClientWithId;

    const client = { id: 'primary' };
    const Client = testDouble<ClientConstructor>({
        rules: [
            rule.whenConstructedWith({ auth: { token: 'primary' } }).constructs(client)
        ]
    });

    assert.equal(new Client({ auth: { token: 'primary' }, baseUrl: 'https://api.example.test' }, 3), client);
});

registerTest('ordered call rules use zero-based indexes', function () {
    type LoadValue = () => string;

    const loadValue = testDouble<LoadValue>({
        rules: [
            rule.onCall(1).returns('second'),
            rule.onCall(0).returns('first')
        ]
    });

    assert.equal(loadValue(), 'first');
    assert.equal(loadValue(), 'second');
});

registerTest('ordered construction rules use zero-based indexes', function () {
    type ClientConstructor = new () => ClientWithId;

    const firstClient = { id: 'first' };
    const secondClient = { id: 'second' };
    const clientConstructor = testDouble<ClientConstructor>({
        rules: [
            rule.onConstruction(1).constructs(secondClient),
            rule.onConstruction(0).constructs(firstClient)
        ]
    });

    assert.equal(Reflect.construct(clientConstructor, []), firstClient);
    assert.equal(Reflect.construct(clientConstructor, []), secondClient);
});

registerTest('rules are evaluated in order and exhausted sequences fall through', function () {
    type LoadValue = (id: string) => string;

    const loadValue = testDouble<LoadValue>({
        rules: [
            rule.when('fixed').returns('first match'),
            rule.when('fixed').returns('later match'),
            rule.when('sequenced').sequence([ 'a', 'b' ]),
            rule.when('sequenced').returns('after sequence')
        ]
    });

    assert.equal(loadValue('fixed'), 'first match');
    assert.equal(loadValue('sequenced'), 'a');
    assert.equal(loadValue('sequenced'), 'b');
    assert.equal(loadValue('sequenced'), 'after sequence');
});

registerTest('rule.sequence() treats raw array values as returns entries', function () {
    type LoadValue = () => string;

    const loadValue = testDouble<LoadValue>({
        fallback: rule.sequence([ 'a', 'b' ])
    });

    assert.equal(loadValue(), 'a');
    assert.equal(loadValue(), 'b');
});

registerTest('rule.sequence() supports async behavior entries', async function () {
    type LoadValue = () => Promise<string>;

    const loadValue = testDouble<LoadValue>({
        fallback: rule.sequence([
            rule.resolves('a'),
            rule.resolves('b')
        ])
    });

    assert.equal(await loadValue(), 'a');
    assert.equal(await loadValue(), 'b');
});

registerTest('fallback can configure call and construction defaults together', function () {
    type ClientFactory = {
        (baseUrl: string): ClientWithId;
        new (baseUrl: string): ClientWithId;
    };

    const calledClient = { id: 'called' };
    const constructedClient = { id: 'constructed' };
    const clientFactory = testDouble<ClientFactory>({
        fallback: {
            call: rule.returns(calledClient),
            construction: rule.constructs(constructedClient)
        }
    });

    assert.equal(clientFactory('https://api.example.test'), calledClient);
    assert.equal(Reflect.construct(clientFactory, [ 'https://api.example.test' ]), constructedClient);
});

registerTest('answer receives invocation arguments, index, and kind', function () {
    type ClientFactory = {
        (id: string): string;
        new (id: string): ClientWithId;
    };

    const constructedClient = { id: 'constructed' };
    const seen: unknown[] = [];
    const clientFactory = testDouble<ClientFactory>({
        answer(invocation) {
            seen.push(invocation);

            return invocation.kind === 'call'
                ? `${invocation.index}:${invocation.arguments[0]}`
                : constructedClient;
        }
    });

    assert.equal(clientFactory('a'), '0:a');
    assert.equal(clientFactory('b'), '1:b');
    assert.equal(Reflect.construct(clientFactory, [ 'c' ]), constructedClient);
    assert.deepEqual(seen, [
        { arguments: [ 'a' ], index: 0, kind: 'call' },
        { arguments: [ 'b' ], index: 1, kind: 'call' },
        { arguments: [ 'c' ], index: 0, kind: 'construction' }
    ]);
});

registerTest('ordered rules reject invalid indexes at runtime', function () {
    assert.throws(function createNegativeCallRule() {
        rule.onCall(-1);
    }, /non-negative integer/u);
    assert.throws(function createFractionalConstructionRule() {
        rule.onConstruction(1.5);
    }, /non-negative integer/u);
});

registerTest('configured doubles throw TypeError when no behavior can answer', function () {
    type LoadValue = (id: string) => string;

    const loadValue = testDouble<LoadValue>({
        rules: [ rule.when('known').returns('value') ]
    });

    assert.throws(function loadUnknownValue() {
        loadValue('unknown');
    }, /no configured behavior/u);
});
