import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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
    test('does not expose fluent behavior on created doubles', function (typeScope) {
        const typed = testDouble.returns<LoadUser>(user);
        const configured = testDouble<LoadUser>({
            fallback: rule.returns(user)
        });

        typeScope.assert(sameType.withActual<false>(), hasKey<'returns'>()(typed));
        typeScope.assert(sameType.withActual<false>(), hasKey<'resolves'>()(typed));
        typeScope.assert(sameType.withActual<false>(), hasKey<'rejects'>()(typed));
        typeScope.assert(sameType.withActual<false>(), hasKey<'throws'>()(typed));
        typeScope.assert(sameType.withActual<false>(), hasKey<'constructs'>()(typed));
        typeScope.assert(sameType.withActual<false>(), hasKey<'returns'>()(configured));
        return typeScope.assert.collect();
    }),
    test('exports configured rule-based doubles', function (typeScope) {
        const loadUser = testDouble<LoadUser>({
            rules: [
                rule.when('1').returns(user),
                rule.onCall(1).returns(user)
            ],
            fallback: rule.throws(new Error('unexpected user'))
        });

        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadUser>>()(loadUser));
        typeScope.assert(acceptsCall, () => loadUser('1', false));
        typeScope.assert(sameType.withActual<true>(), isEqualTo<User>()(loadUser('1', false)));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<LoadUser>({
                fallback: rule.returns(user),
                unknown: true
            }));
        return typeScope.assert.collect();
    }),
    test('type-checks deep-partial argument patterns', function (typeScope) {
        const searchUser = testDouble<SearchUser>({
            rules: [
                rule.when({ profile: { role: 'admin' } }).returns(user),
                rule.when({ id: '1' }, false).returns(user)
            ]
        });

        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<SearchUser>>()(searchUser));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<SearchUser>({
                rules: [ rule.when({ missing: true }).returns(user) ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<SearchUser>({
                rules: [ rule.when({ id: '1' }, false, 'extra').returns(user) ]
            }));
        return typeScope.assert.collect();
    }),
    test('requires non-empty when forms', function (typeScope) {
        typeScope.assert(rejectsCall('argument-count'), () => rule.when());
        typeScope.assert(rejectsCall('argument-count'), () => rule.whenConstructedWith());
        return typeScope.assert.collect();
    }),
    test('requires sequence arrays with at least two entries', function (typeScope) {
        typeScope.assert(acceptsCall, () => rule.sequence([ 'a', 'b' ]));
        typeScope.assert(acceptsCall, () =>
            rule.sequence([
                rule.resolves('a'),
                rule.resolves('b')
            ]));
        typeScope.assert(rejectsCall('argument-type'), () => rule.sequence([ 'a' ]));
        typeScope.assert(rejectsCall('argument-type'), () => rule.sequence([]));
        return typeScope.assert.collect();
    }),
    test('distinguishes returns and resolves for async rules', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<SaveUser>({
                rules: [ rule.when(user).resolves(user) ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<SaveUser>({
                rules: [ rule.when(user).returns(user) ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<LoadUser>({
                rules: [ rule.when('1', false).resolves(user) ]
            }));
        return typeScope.assert.collect();
    }),
    test('type-checks constructor arguments and instances', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<ClientConstructor>({
                rules: [
                    rule.whenConstructedWith('https://api.example.test').constructs(client),
                    rule.onConstruction(1).constructs(client)
                ],
                fallback: rule.constructs(client)
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ClientConstructor>({
                rules: [ rule.whenConstructedWith(1).constructs(client) ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ClientConstructor>({
                rules: [ rule.whenConstructedWith('https://api.example.test').constructs({ id: 'client' }) ]
            }));
        return typeScope.assert.collect();
    }),
    test('types fallback objects and answer invocations', function (typeScope) {
        const Client = testDouble<ClientFactory>({
            fallback: {
                call: rule.returns(client),
                construction: rule.constructs(client)
            }
        });
        const answered = testDouble<SearchUser>({
            answer(invocation) {
                typeScope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<DoubleInvocation<Parameters<SearchUser>>>()(invocation)
                );

                return user;
            }
        });

        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<ClientFactory>>()(Client));
        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<SearchUser>>()(answered));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<LoadUser>({
                answer() {
                    return user;
                },
                fallback: rule.returns(user)
            }));
        return typeScope.assert.collect();
    })
]);
