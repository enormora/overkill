import { suite, test } from '../test/test.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
import { hasKey, isEqualTo } from '../../test-support/type-relations.ts';
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
type ClientFactory = {
    (baseUrl: string): Client;
    new (baseUrl: string): Client;
};

const user: User = { id: '1', name: 'Ada' };
const client: Client = { baseUrl: 'https://api.example.test' };

export const testNode = suite('rule-based doubles', [
    test('does not expose fluent behavior on created doubles', function (scope) {
        const typed = testDouble.returns<LoadUser>(user);
        const configured = testDouble<LoadUser>({
            fallback: rule.returns(user)
        });

        scope.assert(sameType.withActual<false>(), hasKey<'returns'>()(typed));
        scope.assert(sameType.withActual<false>(), hasKey<'resolves'>()(typed));
        scope.assert(sameType.withActual<false>(), hasKey<'rejects'>()(typed));
        scope.assert(sameType.withActual<false>(), hasKey<'throws'>()(typed));
        scope.assert(sameType.withActual<false>(), hasKey<'constructs'>()(typed));
        scope.assert(sameType.withActual<false>(), hasKey<'returns'>()(configured));
        return scope.assert.collect();
    }),
    test('exports configured rule-based doubles', function (scope) {
        const loadUser = testDouble<LoadUser>({
            rules: [
                rule.when('1').returns(user),
                rule.onCall(1).returns(user)
            ],
            fallback: rule.throws(new Error('unexpected user'))
        });

        scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadUser>>()(loadUser));
        scope.assert(acceptsCall, function () {
            return loadUser('1', false);
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<User>()(loadUser('1', false)));
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<LoadUser>({
                fallback: rule.returns(user),
                unknown: true
            });
        });
        return scope.assert.collect();
    }),
    test('type-checks deep-partial argument patterns', function (scope) {
        const searchUser = testDouble<SearchUser>({
            rules: [
                rule.when({ profile: { role: 'admin' } }).returns(user),
                rule.when({ id: '1' }, false).returns(user)
            ]
        });

        scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<SearchUser>>()(searchUser));
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<SearchUser>({
                rules: [ rule.when({ missing: true }).returns(user) ]
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<SearchUser>({
                rules: [ rule.when({ id: '1' }, false, 'extra').returns(user) ]
            });
        });
        return scope.assert.collect();
    }),
    test('requires non-empty when forms', function (scope) {
        scope.assert(rejectsCall('argument-count'), function () {
            return rule.when();
        });
        scope.assert(rejectsCall('argument-count'), function () {
            return rule.whenConstructedWith();
        });
        return scope.assert.collect();
    }),
    test('requires sequence arrays with at least two entries', function (scope) {
        scope.assert(acceptsCall, function () {
            return rule.sequence([ 'a', 'b' ]);
        });
        scope.assert(acceptsCall, function () {
            return rule.sequence([
                rule.resolves('a'),
                rule.resolves('b')
            ]);
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return rule.sequence([ 'a' ]);
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return rule.sequence([]);
        });
        return scope.assert.collect();
    }),
    test('distinguishes returns and resolves for async rules', function (scope) {
        scope.assert(acceptsCall, function () {
            return testDouble<SaveUser>({
                rules: [ rule.when(user).resolves(user) ]
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<SaveUser>({
                rules: [ rule.when(user).returns(user) ]
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<LoadUser>({
                rules: [ rule.when('1', false).resolves(user) ]
            });
        });
        return scope.assert.collect();
    }),
    test('type-checks constructor arguments and instances', function (scope) {
        scope.assert(acceptsCall, function () {
            return testDouble<ClientConstructor>({
                rules: [
                    rule.whenConstructedWith('https://api.example.test').constructs(client),
                    rule.onConstruction(1).constructs(client)
                ],
                fallback: rule.constructs(client)
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ClientConstructor>({
                rules: [ rule.whenConstructedWith(1).constructs(client) ]
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ClientConstructor>({
                rules: [ rule.whenConstructedWith('https://api.example.test').constructs({ id: 'client' }) ]
            });
        });
        return scope.assert.collect();
    }),
    test('types fallback objects and answer invocations', function (scope) {
        const Client = testDouble<ClientFactory>({
            fallback: {
                call: rule.returns(client),
                construction: rule.constructs(client)
            }
        });
        const answered = testDouble<SearchUser>({
            answer(invocation) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<DoubleInvocation<Parameters<SearchUser>>>()(invocation)
                );

                return user;
            }
        });

        scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<ClientFactory>>()(Client));
        scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<SearchUser>>()(answered));
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<LoadUser>({
                answer() {
                    return user;
                },
                fallback: rule.returns(user)
            });
        });
        return scope.assert.collect();
    })
]);
