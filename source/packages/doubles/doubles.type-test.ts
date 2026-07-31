import { describe, expect, test } from 'tstyche';
import {
    rule,
    testDouble,
    type DoubleInvocation,
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

const user: User = { id: '1', name: 'Ada' };
const client: Client = { baseUrl: 'https://api.example.test' };

describe('@overkill-dev/doubles', function () {
    describe('fixed doubles', function () {
        test('creates an untyped default double', function () {
            const value = testDouble();

            expect(value).type.toBe<(...arguments_: readonly unknown[]) => unknown>();
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
            const voidCallback = testDouble.returns<() => void>();

            expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => User>();
            expect(typed).type.toBe<TestDouble<LoadUser>>();
            expect(typed).type.toBeCallableWith('1', false);
            expect(typed).type.not.toBeCallableWith(1, false);
            expect(typed('1', false)).type.toBe<User>();
            expect(voidCallback).type.toBe<() => void>();
        });

        test('creates fixed-resolution doubles', function () {
            const untyped = testDouble.resolves(user);
            const typed = testDouble.resolves<SaveUser>(user);

            expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => Promise<User>>();
            expect(typed).type.toBe<TestDouble<SaveUser>>();
            expect(typed).type.toBeCallableWith(user);
            expect(typed).type.not.toBeCallableWith('user');
            expect(typed(user)).type.toBe<Promise<User>>();
            expect(testDouble.resolves<LoadUser>).type.not.toBeCallableWith(user);
        });

        test('creates fixed-rejection doubles', function () {
            const untyped = testDouble.rejects(new Error('expected'));
            const typed = testDouble.rejects<SaveUser>(new Error('expected'));

            expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => Promise<never>>();
            expect(typed).type.toBe<TestDouble<SaveUser>>();
            expect(typed).type.toBeCallableWith(user);
            expect(typed(user)).type.toBe<Promise<User>>();
            expect(testDouble.rejects<LoadUser>).type.not.toBeCallableWith(new Error('expected'));
        });

        test('creates fixed-throw doubles', function () {
            const untyped = testDouble.throws(new Error('expected'));
            const typed = testDouble.throws<LoadUser>(new Error('expected'));

            expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => never>();
            expect(typed).type.toBe<TestDouble<LoadUser>>();
            expect(typed).type.toBeCallableWith('1', false);
            expect(typed('1', false)).type.toBe<User>();
            expect(testDouble.throws<SaveUser>).type.not.toBeCallableWith(new Error('expected'));
        });

        test('creates fixed-construction doubles', function () {
            const untyped = testDouble.constructs(client);
            const TypedClient = testDouble.constructs<ClientConstructor>(client);

            expect(untyped).type.toBe<new (...arguments_: readonly unknown[]) => Client>();
            expect(TypedClient).type.toBe<TestDouble<ClientConstructor>>();
            expect(new TypedClient('https://api.example.test')).type.toBe<Client>();
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
            type ClientFactory = {
                (baseUrl: string): Client;
                new (baseUrl: string): Client;
            };

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
