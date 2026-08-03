import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { rule } from './double-rule.ts';
import { testDouble, type TestDouble } from './test-double.ts';

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
type ClientWithIdConstructor = new (baseUrl: string) => ClientWithId;
type ClientFactoryDoubleSignature = {
    (baseUrl: string): ClientWithId;
    new (baseUrl: string): ClientWithId;
};
type ClientOptions = {
    readonly auth: ClientAuth;
    readonly baseUrl: string;
};
type ClientAuth = {
    readonly token: string;
};
type ScopedReceiver = {
    readonly scope: string;
};
type LoadScopedValue = (this: ScopedReceiver, id: string) => string;
type RecordedScopedLoadValue = {
    readonly loadValue: TestDouble<LoadScopedValue>;
    readonly receiver: ScopedReceiver;
};
type RecordedClientConstructor = {
    readonly Client: TestDouble<ClientWithIdConstructor>;
    readonly client: ClientWithId;
};
type RecordedClientFactory = {
    readonly calledClient: ClientWithId;
    readonly clientFactoryDouble: TestDouble<ClientFactoryDoubleSignature>;
    readonly constructedClient: ClientWithId;
};

function requireRecordedValue<Value>(value: Value | null, message: string): Value {
    if (value === null) {
        assert.fail(message);
    }

    return value;
}

function createRecordedScopedLoadValue(): RecordedScopedLoadValue {
    const receiver = { scope: 'test' };
    const loadValue = testDouble.returns<LoadScopedValue>('value');

    assert.equal(loadValue.call(receiver, 'a'), 'value');

    return { loadValue, receiver };
}

function createRecordedClientConstructor(): RecordedClientConstructor {
    const client = { id: 'client' };
    const Client = testDouble.constructs<ClientWithIdConstructor>(client);

    assert.equal(new Client('https://api.example.test'), client);

    return { Client, client };
}

function createRecordedClientFactory(): RecordedClientFactory {
    const calledClient = { id: 'called' };
    const constructedClient = { id: 'constructed' };
    const clientFactoryDouble = testDouble<ClientFactoryDoubleSignature>({
        fallback: {
            call: rule.returns(calledClient),
            construction: rule.constructs(constructedClient)
        }
    });

    assert.equal(clientFactoryDouble('call'), calledClient);
    assert.equal(Reflect.construct(clientFactoryDouble, [ 'construction' ]), constructedClient);

    return { calledClient, clientFactoryDouble, constructedClient };
}

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

registerTest('doubles expose aggregate counts for returned calls', function () {
    const { loadValue } = createRecordedScopedLoadValue();

    assert.equal(loadValue.interactionCount, 1);
    assert.equal(loadValue.callCount, 1);
    assert.equal(loadValue.constructionCount, 0);
    assert.equal(loadValue.nthCall(1), null);
});

registerTest('doubles expose aggregate call history for returned calls', function () {
    const { loadValue, receiver } = createRecordedScopedLoadValue();
    const firstInteraction = requireRecordedValue(loadValue.firstInteraction, 'expected recorded interaction');
    const firstCall = requireRecordedValue(loadValue.firstCall, 'expected recorded call');

    assert.equal(firstInteraction.kind, 'call');
    assert.deepEqual(firstCall.arguments, [ 'a' ]);
    assert.equal(firstCall.thisValue, receiver);
    assert.equal(firstCall.index, 0);
    assert.equal(firstCall.order, 0);
    assert.equal(requireRecordedValue(loadValue.nthCall(0), 'expected nth call').result.status, 'returned');
});

registerTest('doubles expose returned call result history', function () {
    const { loadValue } = createRecordedScopedLoadValue();
    const lastResult = requireRecordedValue(loadValue.lastResult, 'expected recorded result');

    assert.equal(lastResult.status, 'returned');
});

registerTest('doubles expose construction counts for returned constructions', function () {
    const { Client } = createRecordedClientConstructor();

    assert.equal(Client.interactionCount, 1);
    assert.equal(Client.callCount, 0);
    assert.equal(Client.constructionCount, 1);
});

registerTest('doubles expose construction history for returned constructions', function () {
    const { Client, client } = createRecordedClientConstructor();
    const firstConstruction = requireRecordedValue(Client.firstConstruction, 'expected recorded construction');
    const firstInteraction = requireRecordedValue(Client.firstInteraction, 'expected recorded interaction');

    assert.deepEqual(firstConstruction.arguments, [ 'https://api.example.test' ]);
    assert.equal(firstConstruction.instance, client);
    assert.equal(firstConstruction.result.status, 'returned');
    assert.equal(firstInteraction.kind, 'construction');
});

registerTest('aggregate history counts calls and constructions together', function () {
    const { clientFactoryDouble } = createRecordedClientFactory();

    assert.equal(clientFactoryDouble.interactionCount, 2);
    assert.equal(clientFactoryDouble.callCount, 1);
    assert.equal(clientFactoryDouble.constructionCount, 1);
});

registerTest('aggregate history preserves chronological call and construction order', function () {
    const { clientFactoryDouble } = createRecordedClientFactory();

    assert.deepEqual(
        clientFactoryDouble.interactions.map(function interactionKind(interaction) {
            return interaction.kind;
        }),
        [ 'call', 'construction' ]
    );
    assert.deepEqual(
        clientFactoryDouble.results.map(function resultKind(result) {
            return result.invocationKind;
        }),
        [ 'call', 'construction' ]
    );
    assert.equal(requireRecordedValue(clientFactoryDouble.firstResult, 'expected first result').order, 0);
    assert.equal(requireRecordedValue(clientFactoryDouble.lastResult, 'expected last result').order, 1);
});

registerTest('history records thrown calls', function () {
    type LoadValue = (id: string) => string;

    const expected = new Error('expected');
    const throwingLoadValue = testDouble.throws<LoadValue>(expected);

    assert.throws(function throwConfiguredError() {
        throwingLoadValue('id');
    }, expected);

    assert.equal(throwingLoadValue.firstResult?.status, 'threw');
});

registerTest('history records missing behavior', function () {
    type LoadValue = (id: string) => string;

    const missingLoadValue = testDouble<LoadValue>({
        rules: [ rule.when('known').returns('value') ]
    });

    assert.throws(function throwMissingBehavior() {
        missingLoadValue('unknown');
    }, /no configured behavior/u);

    assert.equal(missingLoadValue.firstResult?.status, 'threw');
});

registerTest('history records unsupported invocation modes', function () {
    const Client = testDouble.constructs({ id: 'client' });

    assert.throws(function callConstructorDouble() {
        (Client as unknown as () => unknown)();
    }, /Class constructor/u);

    assert.equal(Client.firstCall?.result.status, 'threw');
    assert.equal(Client.callCount, 1);
});

registerTest('history records thrown constructions with null instances', function () {
    type ClientConstructor = new () => ClientWithId;

    const error = new Error('expected');
    const Client = testDouble<ClientConstructor>({
        fallback: rule.throws(error)
    });

    assert.throws(function constructClientForHistory() {
        Reflect.construct(Client, []);
    }, error);

    assert.equal(Client.constructionCount, 1);
    const firstConstruction = requireRecordedValue(Client.firstConstruction, 'expected thrown construction');
    assert.equal(firstConstruction.instance, null);
    assert.equal(firstConstruction.result.status, 'threw');
});

registerTest('promise results are recorded immediately without awaiting settlement', async function () {
    const error = new Error('expected');
    const loadValue = testDouble.rejects(error);
    const promise = loadValue('id');
    const firstResult = requireRecordedValue(loadValue.firstResult, 'expected returned promise result');

    assert.equal(firstResult.status, 'returned');
    assert.equal(firstResult.value, promise);
    await assert.rejects(async function awaitRejectedValue() {
        await promise;
    }, error);
    assert.equal(requireRecordedValue(loadValue.firstResult, 'expected retained promise result').status, 'returned');
});
