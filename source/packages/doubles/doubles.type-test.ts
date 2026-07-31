import { describe, expect, test } from 'tstyche';
import {
    rule,
    testDouble,
    type DoubleCall,
    type DoubleConstruction,
    type DoubleHistory,
    type DoubleInvocation,
    type DoubleResult,
    type TestDouble
} from './doubles.entry-point.ts';

type User = {
    readonly id: string;
    readonly name: string;
};

type Client = {
    readonly baseUrl: string;
};

type UserQuery = {
    readonly id: string;
    readonly profile: {
        readonly role: string;
    };
};

type LoadUser = (id: string, includeDeleted: boolean) => User;
type SearchUser = (query: UserQuery, includeDeleted: boolean) => User;
type SaveUser = (user: User) => Promise<User>;
type ClientConstructor = new (baseUrl: string) => Client;
type ScopeReceiver = {
    readonly scope: string;
};
type ScopedLoadUser = (this: ScopeReceiver, id: string) => User;
type ClientFactory = {
    (baseUrl: string): Client;
    new (baseUrl: string): Client;
};
type OverloadedLoad = {
    (id: string): User;
    (id: number, includeDeleted: boolean): Client;
};
type ClientConstructorOptions = {
    readonly baseUrl: string;
    readonly timeout: number;
};
type OverloadedClientConstructor = {
    new (baseUrl: string): Client;
    new (options: ClientConstructorOptions): ClientWithTimeout;
};
type ClientWithTimeout = Client & {
    readonly timeout: number;
};
type NumberLoadArguments = Parameters<(id: number, includeDeleted: boolean) => Client>;
type StringLoadArguments = Parameters<(id: string) => User>;
type OptionsConstructionArguments = ConstructorParameters<new (options: ClientConstructorOptions) => ClientWithTimeout>;
type StringConstructionArguments = ConstructorParameters<new (baseUrl: string) => Client>;
type ExpectedClientFactoryInteraction = {
    readonly call: DoubleCall<Parameters<ClientFactory>, Client>;
    readonly construction: DoubleConstruction<ConstructorParameters<ClientFactory>, Client>;
    readonly missing: null;
}[
    keyof {
        readonly call: unknown;
        readonly construction: unknown;
        readonly missing: unknown;
    }
];
type ExpectedOverloadedCall = {
    readonly numberCall: DoubleCall<NumberLoadArguments, Client>;
    readonly stringCall: DoubleCall<StringLoadArguments, User>;
    readonly missing: null;
}[
    keyof {
        readonly numberCall: unknown;
        readonly stringCall: unknown;
        readonly missing: unknown;
    }
];
type ExpectedOverloadedConstruction = {
    readonly stringConstruction: DoubleConstruction<StringConstructionArguments, Client>;
    readonly optionsConstruction: DoubleConstruction<OptionsConstructionArguments, ClientWithTimeout>;
    readonly missing: null;
}[
    keyof {
        readonly stringConstruction: unknown;
        readonly optionsConstruction: unknown;
        readonly missing: unknown;
    }
];

const user: User = { id: '1', name: 'Ada' };
const client: Client = { baseUrl: 'https://api.example.test' };
const clientWithTimeout: ClientWithTimeout = { baseUrl: 'https://api.example.test', timeout: 500 };

describe('@overkill-dev/doubles', function () {
    describe('fixed doubles', function () {
        test('creates an untyped default double', function () {
            const value = testDouble();

            expect(value).type.toBe<TestDouble<(...arguments_: readonly unknown[]) => unknown>>();
            expect(value('id')).type.toBe<unknown>();
        });

        test('preserves explicit default double signatures', function () {
            const typed = testDouble<LoadUser>();

            expect(typed).type.toBe<TestDouble<LoadUser>>();
        });

        test('allows calls matching explicit default double signatures', function () {
            const typed = testDouble<LoadUser>();

            expect(typed).type.toBeCallableWith('1', false);
        });

        test('creates fixed-return doubles', function () {
            const untyped = testDouble.returns(user);
            const typed = testDouble.returns<LoadUser>(user);

            expect(untyped).type.toBe<TestDouble<(...arguments_: readonly unknown[]) => User>>();
            expect(typed).type.toBe<TestDouble<LoadUser>>();
            expect(typed).type.toBeCallableWith('1', false);
            expect(typed).type.not.toBeCallableWith(1, false);
            expect(typed('1', false)).type.toBe<User>();
        });

        test('creates fixed void-return doubles', function () {
            const voidCallback = testDouble.returns<() => void>();

            expect(voidCallback).type.toBe<TestDouble<() => void>>();
        });

        test('creates fixed-resolution doubles', function () {
            const untyped = testDouble.resolves(user);
            const typed = testDouble.resolves<SaveUser>(user);

            expect(untyped).type.toBe<TestDouble<(...arguments_: readonly unknown[]) => Promise<User>>>();
            expect(typed).type.toBe<TestDouble<SaveUser>>();
            expect(typed).type.toBeCallableWith(user);
            expect(typed).type.not.toBeCallableWith('user');
            expect(typed(user)).type.toBe<Promise<User>>();
            expect(testDouble.resolves<LoadUser>).type.not.toBeCallableWith(user);
        });

        test('creates fixed-rejection doubles', function () {
            const untyped = testDouble.rejects(new Error('expected'));
            const typed = testDouble.rejects<SaveUser>(new Error('expected'));

            expect(untyped).type.toBe<TestDouble<(...arguments_: readonly unknown[]) => Promise<never>>>();
            expect(typed).type.toBe<TestDouble<SaveUser>>();
            expect(typed).type.toBeCallableWith(user);
            expect(typed(user)).type.toBe<Promise<User>>();
            expect(testDouble.rejects<LoadUser>).type.not.toBeCallableWith(new Error('expected'));
        });

        test('creates fixed-throw doubles', function () {
            const untyped = testDouble.throws(new Error('expected'));
            const typed = testDouble.throws<LoadUser>(new Error('expected'));

            expect(untyped).type.toBe<TestDouble<(...arguments_: readonly unknown[]) => never>>();
            expect(typed).type.toBe<TestDouble<LoadUser>>();
            expect(typed).type.toBeCallableWith('1', false);
            expect(typed('1', false)).type.toBe<User>();
            expect(testDouble.throws<SaveUser>).type.not.toBeCallableWith(new Error('expected'));
        });

        test('creates fixed-construction doubles', function () {
            const untyped = testDouble.constructs(client);
            const TypedClient = testDouble.constructs<ClientConstructor>(client);

            expect(untyped).type.toBe<TestDouble<new (...arguments_: readonly unknown[]) => Client>>();
            expect(TypedClient).type.toBe<TestDouble<ClientConstructor>>();
            expect(new TypedClient('https://api.example.test')).type.toBe<Client>();
        });
    });

    describe('history types', function () {
        test('exposes typed history counts and reset on callable doubles', function () {
            const loadUser = testDouble<LoadUser>();

            expect(loadUser).type.toBeAssignableTo<DoubleHistory<LoadUser>>();
            expect(loadUser.callCount).type.toBe<number>();
            expect(loadUser.interactionCount).type.toBe<number>();
            expect(loadUser.reset).type.toBe<() => void>();
            expect(loadUser.reset).type.not.toBeCallableWith('history');
        });

        test('exposes typed call history records', function () {
            const loadUser = testDouble<LoadUser>();
            const scopedLoadUser = testDouble<ScopedLoadUser>();
            const saveUser = testDouble<SaveUser>();

            expect(loadUser.calls).type.toBe<readonly DoubleCall<Parameters<LoadUser>, User>[]>();
            expect(loadUser.firstCall).type.toBe<DoubleCall<Parameters<LoadUser>, User> | null>();
            expect(loadUser.lastCall).type.toBe<DoubleCall<Parameters<LoadUser>, User> | null>();
            expect(loadUser.nthCall(0)).type.toBe<DoubleCall<Parameters<LoadUser>, User> | null>();
            expect(scopedLoadUser.firstCall).type.toBe<
                DoubleCall<Parameters<ScopedLoadUser>, User, ScopeReceiver> | null
            >();
            expect(saveUser.firstResult).type.toBe<DoubleResult<Promise<User>> | null>();
        });

        test('exposes typed construction and aggregate interaction history', function () {
            const Client = testDouble<ClientConstructor>({
                fallback: rule.constructs(client)
            });
            const ClientFactoryDouble = testDouble<ClientFactory>({
                fallback: {
                    call: rule.returns(client),
                    construction: rule.constructs(client)
                }
            });

            expect(Client.constructions).type.toBe<
                readonly DoubleConstruction<ConstructorParameters<ClientConstructor>, Client>[]
            >();
            expect(Client.firstConstruction).type.toBe<
                DoubleConstruction<ConstructorParameters<ClientConstructor>, Client> | null
            >();
            expect(ClientFactoryDouble.firstInteraction).type.toBe<ExpectedClientFactoryInteraction>();
            expect(ClientFactoryDouble.nthInteraction(0)).type.toBe<ExpectedClientFactoryInteraction>();
        });

        test('preserves overloads in history records up to the supported cap', function () {
            const loadValue = testDouble<OverloadedLoad>();
            const Client = testDouble<OverloadedClientConstructor>({
                fallback: rule.constructs(clientWithTimeout)
            });

            expect(loadValue.firstCall).type.toBe<ExpectedOverloadedCall>();
            expect(Client.firstConstruction).type.toBe<ExpectedOverloadedConstruction>();
        });
    });

    describe('rule-based doubles', function () {
        test('does not expose fluent behavior on created doubles', function () {
            const typed = testDouble.returns<LoadUser>(user);
            const configured = testDouble<LoadUser>({
                fallback: rule.returns(user)
            });

            expect(typed).type.not.toHaveProperty('returns');
            expect(typed).type.not.toHaveProperty('resolves');
            expect(typed).type.not.toHaveProperty('rejects');
            expect(typed).type.not.toHaveProperty('throws');
            expect(typed).type.not.toHaveProperty('constructs');
            expect(configured).type.not.toHaveProperty('returns');
        });

        test('exports configured rule-based doubles', function () {
            const loadUser = testDouble<LoadUser>({
                rules: [
                    rule.when('1').returns(user),
                    rule.onCall(1).returns(user)
                ],
                fallback: rule.throws(new Error('unexpected user'))
            });

            expect(loadUser).type.toBe<TestDouble<LoadUser>>();
            expect(loadUser).type.toBeCallableWith('1', false);
            expect(loadUser('1', false)).type.toBe<User>();
            expect(testDouble<LoadUser>).type.not.toBeCallableWith({
                fallback: rule.returns(user),
                unknown: true
            });
        });

        test('type-checks deep-partial argument patterns', function () {
            const searchUser = testDouble<SearchUser>({
                rules: [
                    rule.when({ profile: { role: 'admin' } }).returns(user),
                    rule.when({ id: '1' }, false).returns(user)
                ]
            });

            expect(searchUser).type.toBe<TestDouble<SearchUser>>();
            expect(testDouble<SearchUser>).type.not.toBeCallableWith({
                rules: [ rule.when({ missing: true }).returns(user) ]
            });
            expect(testDouble<SearchUser>).type.not.toBeCallableWith({
                rules: [ rule.when({ id: '1' }, false, 'extra').returns(user) ]
            });
        });

        test('requires non-empty when forms', function () {
            expect(rule.when).type.not.toBeCallableWith();
            expect(rule.whenConstructedWith).type.not.toBeCallableWith();
        });

        test('requires sequence arrays with at least two entries', function () {
            expect(rule.sequence).type.toBeCallableWith([ 'a', 'b' ]);
            expect(rule.sequence).type.toBeCallableWith([
                rule.resolves('a'),
                rule.resolves('b')
            ]);
            expect(rule.sequence).type.not.toBeCallableWith([ 'a' ]);
            expect(rule.sequence).type.not.toBeCallableWith([]);
        });

        test('distinguishes returns and resolves for async rules', function () {
            expect(testDouble<SaveUser>).type.toBeCallableWith({
                rules: [ rule.when(user).resolves(user) ]
            });
            expect(testDouble<SaveUser>).type.not.toBeCallableWith({
                rules: [ rule.when(user).returns(user) ]
            });
            expect(testDouble<LoadUser>).type.not.toBeCallableWith({
                rules: [ rule.when('1', false).resolves(user) ]
            });
        });

        test('type-checks constructor arguments and instances', function () {
            expect(testDouble<ClientConstructor>).type.toBeCallableWith({
                rules: [
                    rule.whenConstructedWith('https://api.example.test').constructs(client),
                    rule.onConstruction(1).constructs(client)
                ],
                fallback: rule.constructs(client)
            });
            expect(testDouble<ClientConstructor>).type.not.toBeCallableWith({
                rules: [ rule.whenConstructedWith(1).constructs(client) ]
            });
            expect(testDouble<ClientConstructor>).type.not.toBeCallableWith({
                rules: [ rule.whenConstructedWith('https://api.example.test').constructs({ id: 'client' }) ]
            });
        });

        test('types fallback objects and answer invocations', function () {
            const Client = testDouble<ClientFactory>({
                fallback: {
                    call: rule.returns(client),
                    construction: rule.constructs(client)
                }
            });
            const answered = testDouble<SearchUser>({
                answer(invocation) {
                    expect(invocation).type.toBe<DoubleInvocation<Parameters<SearchUser>>>();

                    return user;
                }
            });

            expect(Client).type.toBe<TestDouble<ClientFactory>>();
            expect(answered).type.toBe<TestDouble<SearchUser>>();
            expect(testDouble<LoadUser>).type.not.toBeCallableWith({
                answer() {
                    return user;
                },
                fallback: rule.returns(user)
            });
        });
    });
});
