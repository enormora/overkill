import { suite, test } from '@overkill-dev/test';
import {
    acceptsCall,
    assignableFrom,
    assignableTo,
    rejectsCall,
    sameType
} from '@overkill-dev/type-test';
import type { AssertAssertionFacade } from '../engine/engine.entry-point.ts';
import { isEqualTo, isAssignableTo } from '../../test-support/type-relations.ts';
import {
    doubleUsage,
    rule,
    testDouble,
    type DoubleCall,
    type DoubleConstruction,
    type DoubleHistory,
    type DoubleIteratorEvent,
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

type LoadUser = (id: string, includeDeleted: boolean) => User;
type SaveUser = (user: User) => Promise<User>;
type UntypedDouble<Result> = TestDouble<(...arguments_: readonly unknown[]) => Result>;
type LoadEvents = (id: string) => Generator<string, number, boolean>;
type LoadEventProtocolArguments = readonly [] | readonly [boolean] | readonly [number] | readonly [unknown];
type LoadAsyncEvents = (id: string) => AsyncGenerator<string, number, boolean>;
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
declare const assertFacade: AssertAssertionFacade;

export const testNode = suite('Test doubles, call history, and usage assertions', [
    suite('fixed doubles', [
        test('creates an untyped default double', function (scope) {
            const value = testDouble();

            scope.assert(sameType.withActual<true>(), isEqualTo<UntypedDouble<unknown>>()(value));
            scope.assert(sameType.withActual<unknown>(), value('id'));
            return scope.assert.collect();
        }),
        test('preserves explicit default double signatures', function (scope) {
            const typed = testDouble<LoadUser>();

            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadUser>>()(typed));
            return scope.assert.collect();
        }),
        test('allows calls matching explicit default double signatures', function (scope) {
            const typed = testDouble<LoadUser>();

            scope.assert(acceptsCall, function () {
                return typed('1', false);
            });
            return scope.assert.collect();
        }),
        test('creates fixed-return doubles', function (scope) {
            const untyped = testDouble.returns(user);
            const typed = testDouble.returns<LoadUser>(user);

            scope.assert(sameType.withActual<true>(), isEqualTo<UntypedDouble<User>>()(untyped));
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadUser>>()(typed));
            scope.assert(acceptsCall, function () {
                return typed('1', false);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return typed(1, false);
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<User>()(typed('1', false)));
            return scope.assert.collect();
        }),
        test('creates fixed void-return doubles', function (scope) {
            const voidCallback = testDouble.returns<() => void>();

            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<() => void>>()(voidCallback));
            return scope.assert.collect();
        }),
        test('creates fixed-resolution doubles', function (scope) {
            const untyped = testDouble.resolves(user);
            const typed = testDouble.resolves<SaveUser>(user);

            scope.assert(sameType.withActual<true>(), isEqualTo<UntypedDouble<Promise<User>>>()(untyped));
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<SaveUser>>()(typed));
            scope.assert(acceptsCall, async function () {
                return typed(user);
            });
            scope.assert(rejectsCall('argument-type'), async function () {
                return typed('user');
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<Promise<User>>()(typed(user)));
            scope.assert(rejectsCall('argument-type'), function () {
                return testDouble.resolves<LoadUser>(user);
            });
            return scope.assert.collect();
        }),
        test('creates fixed-rejection doubles', function (scope) {
            const untyped = testDouble.rejects(new Error('expected'));
            const typed = testDouble.rejects<SaveUser>(new Error('expected'));

            scope.assert(sameType.withActual<true>(), isEqualTo<UntypedDouble<Promise<never>>>()(untyped));
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<SaveUser>>()(typed));
            scope.assert(acceptsCall, async function () {
                return typed(user);
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<Promise<User>>()(typed(user)));
            scope.assert(rejectsCall('argument-type'), function () {
                return testDouble.rejects<LoadUser>(new Error('expected'));
            });
            return scope.assert.collect();
        }),
        test('creates fixed-throw doubles', function (scope) {
            const untyped = testDouble.throws(new Error('expected'));
            const typed = testDouble.throws<LoadUser>(new Error('expected'));

            scope.assert(sameType.withActual<true>(), isEqualTo<UntypedDouble<never>>()(untyped));
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadUser>>()(typed));
            scope.assert(acceptsCall, function () {
                return typed('1', false);
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<User>()(typed('1', false)));
            scope.assert(rejectsCall('argument-type'), function () {
                return testDouble.throws<SaveUser>(new Error('expected'));
            });
            return scope.assert.collect();
        }),
        test('creates fixed-construction doubles', function (scope) {
            const untyped = testDouble.constructs(client);
            const TypedClient = testDouble.constructs<ClientConstructor>(client);

            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestDouble<new (...arguments_: readonly unknown[]) => Client>>()(untyped)
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<ClientConstructor>>()(TypedClient));
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<Client>()(new TypedClient('https://api.example.test'))
            );
            return scope.assert.collect();
        })
    ]),
    suite('fixed generator doubles', [
        test('creates fixed sync generator doubles', function (scope) {
            const untyped = testDouble.yields([ 'created' ]);
            const typed = testDouble.yields<LoadEvents>([ 'created' ], 1);

            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestDouble<(...arguments_: readonly unknown[]) => Generator<string, undefined, unknown>>>()(
                    untyped
                )
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadEvents>>()(typed));
            scope.assert(acceptsCall, function () {
                return typed('1');
            });
            scope.assert(sameType.withActual<true>(), isEqualTo<Generator<string, number, boolean>>()(typed('1')));
            return scope.assert.collect();
        }),
        test('creates fixed sync generator doubles from sources', function (scope) {
            const fromSource = testDouble.yieldsFrom<LoadEvents>(function* loadEvents(id) {
                yield id;
                return 1;
            });

            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadEvents>>()(fromSource));
            return scope.assert.collect();
        }),
        test('rejects non-generator fixed sync generator doubles', function (scope) {
            scope.assert(rejectsCall('no-matching-overload'), function () {
                return testDouble.yields<LoadUser>([ 'event' ]);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return testDouble.yields<LoadEvents>([ 'event' ], 'done');
            });
            return scope.assert.collect();
        }),
        test('creates fixed async generator doubles', function (scope) {
            const untyped = testDouble.yieldsAsync([ 'created' ]);
            const typed = testDouble.yieldsAsync<LoadAsyncEvents>([ 'created' ], 1);

            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<
                    TestDouble<(...arguments_: readonly unknown[]) => AsyncGenerator<string, undefined, unknown>>
                >()(untyped)
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadAsyncEvents>>()(typed));
            scope.assert(acceptsCall, function () {
                return typed('1');
            });
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<AsyncGenerator<string, number, boolean>>()(typed('1'))
            );
            return scope.assert.collect();
        }),
        test('creates fixed async generator doubles from sources', function (scope) {
            const fromAsyncSource = testDouble.yieldsAsyncFrom<LoadAsyncEvents>(async function* loadEvents(id) {
                yield id;
                return 1;
            });
            const fromSyncSource = testDouble.yieldsAsyncFrom<LoadAsyncEvents>(function* loadEvents(id) {
                yield id;
                return 1;
            });

            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadAsyncEvents>>()(fromAsyncSource));
            scope.assert(sameType.withActual<true>(), isEqualTo<TestDouble<LoadAsyncEvents>>()(fromSyncSource));
            return scope.assert.collect();
        }),
        test('rejects non-generator fixed async generator doubles', function (scope) {
            scope.assert(rejectsCall('no-matching-overload'), function () {
                return testDouble.yieldsAsync<LoadUser>([ 'event' ]);
            });
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    return testDouble.yieldsAsync<LoadAsyncEvents>([ 'event' ], 'done');
                }
            );
            return scope.assert.collect();
        })
    ]),
    suite('history types', [
        test('exposes typed history counts and reset on callable doubles', function (scope) {
            const loadUser = testDouble<LoadUser>();

            scope.assert(sameType.withActual<true>(), isAssignableTo<DoubleHistory<LoadUser>>()(loadUser));
            scope.assert(sameType.withActual<number>(), loadUser.callCount);
            scope.assert(sameType.withActual<number>(), loadUser.interactionCount);
            scope.assert(sameType.withActual<true>(), isEqualTo<() => void>()(loadUser.reset));
            scope.assert(rejectsCall('argument-count'), function () {
                loadUser.reset('history');
            });
            return scope.assert.collect();
        }),
        test('exposes typed call history records', function (scope) {
            const loadUser = testDouble<LoadUser>();
            const scopedLoadUser = testDouble<ScopedLoadUser>();
            const saveUser = testDouble<SaveUser>();

            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<readonly DoubleCall<Parameters<LoadUser>, User>[]>()(loadUser.calls)
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleCall<Parameters<LoadUser>, User> | null>()(loadUser.firstCall)
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleCall<Parameters<LoadUser>, User> | null>()(loadUser.lastCall)
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleCall<Parameters<LoadUser>, User> | null>()(loadUser.nthCall(0))
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleCall<Parameters<ScopedLoadUser>, User, ScopeReceiver> | null>()(
                    scopedLoadUser.firstCall
                )
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleResult<Promise<User>> | null>()(saveUser.firstResult)
            );
            return scope.assert.collect();
        }),
        test('exposes typed iterator history records', function (scope) {
            const loadEvents = testDouble.yields<LoadEvents>([ 'created' ], 1);
            const plain = testDouble.returns<LoadUser>(user);

            scope.assert(sameType.withActual<number>(), loadEvents.iteratorEventCount);
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<readonly DoubleIteratorEvent<string, number, LoadEventProtocolArguments>[]>()(
                    loadEvents.iteratorEvents
                )
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleIteratorEvent<string, number, LoadEventProtocolArguments> | null>()(
                    loadEvents.firstIteratorEvent
                )
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleIteratorEvent<string, number, LoadEventProtocolArguments> | null>()(
                    loadEvents.nthIteratorEvent(0)
                )
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleIteratorEvent | null>()(plain.firstIteratorEvent)
            );
            return scope.assert.collect();
        }),
        test('exposes typed construction and aggregate interaction history', function (scope) {
            const Client = testDouble<ClientConstructor>({
                fallback: rule.constructs(client)
            });
            const ClientFactoryDouble = testDouble<ClientFactory>({
                fallback: {
                    call: rule.returns(client),
                    construction: rule.constructs(client)
                }
            });

            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<readonly DoubleConstruction<ConstructorParameters<ClientConstructor>, Client>[]>()(
                    Client.constructions
                )
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<DoubleConstruction<ConstructorParameters<ClientConstructor>, Client> | null>()(
                    Client.firstConstruction
                )
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<ExpectedClientFactoryInteraction>()(ClientFactoryDouble.firstInteraction)
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<ExpectedClientFactoryInteraction>()(ClientFactoryDouble.nthInteraction(0))
            );
            return scope.assert.collect();
        }),
        test('preserves overloads in history records up to the supported cap', function (scope) {
            const loadValue = testDouble<OverloadedLoad>();
            const Client = testDouble<OverloadedClientConstructor>({
                fallback: rule.constructs(clientWithTimeout)
            });

            scope.assert(sameType.withActual<true>(), isEqualTo<ExpectedOverloadedCall>()(loadValue.firstCall));
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<ExpectedOverloadedConstruction>()(Client.firstConstruction)
            );
            return scope.assert.collect();
        })
    ]),
    suite('double usage assertions', [
        test('exports assertion references under one namespace', function (scope) {
            scope.assert(assignableTo.withActual<unknown>(), doubleUsage.calledOnceWith);
            scope.assert(assignableFrom<keyof typeof doubleUsage, 'calledWithExactly'>());
            scope.assert(assignableFrom<keyof typeof doubleUsage, 'yieldedExactly'>());
            scope.assert(assignableFrom<keyof typeof doubleUsage, 'interactionOrder'>());
            scope.assert(assignableFrom.not<keyof typeof doubleUsage, 'returnedWith'>());
            return scope.assert.collect();
        }),
        suite('accepts doubles through the engine assert facade', [
            test('counts interactions and matches calls', function (scope) {
                const loadUser = testDouble<LoadUser>();
                const Client = testDouble<ClientConstructor>({
                    fallback: rule.constructs(client)
                });
                scope.assert(acceptsCall, function () {
                    assertFacade(doubleUsage.called, loadUser);
                });
                scope.assert(acceptsCall, function () {
                    assertFacade(doubleUsage.calledWith, loadUser, [ '1', false ]);
                });
                scope.assert(
                    acceptsCall,
                    function () {
                        assertFacade(doubleUsage.calledWithExactly, loadUser, [ '1', false ]);
                    }
                );
                scope.assert(acceptsCall, function () {
                    assertFacade(doubleUsage.calledWithPrefix, loadUser, [ '1' ]);
                });
                scope.assert(acceptsCall, function () {
                    assertFacade(doubleUsage.nthCallWith, loadUser, 0, [ '1', false ]);
                });
                scope.assert(
                    acceptsCall,
                    function () {
                        assertFacade(doubleUsage.constructedWith, Client, [ 'https://api.example.test' ]);
                    }
                );
                return scope.assert.collect();
            }),
            test('matches invocation and result evidence', function (scope) {
                const loadUser = testDouble<LoadUser>();
                scope.assert(acceptsCall, function () {
                    assertFacade(doubleUsage.callCount, loadUser, 1);
                });
                scope.assert(
                    acceptsCall,
                    function () {
                        assertFacade(doubleUsage.callOrder, [ loadUser, testDouble<LoadUser>() ]);
                    }
                );
                return scope.assert.collect();
            })
        ]),
        test('accepts generator doubles through the engine assert facade', function (scope) {
            scope.assert(
                acceptsCall,
                function () {
                    assertFacade(doubleUsage.yieldedExactly, testDouble.yields([ 'event' ]), [ 'event' ]);
                }
            );
            return scope.assert.collect();
        }),
        test('rejects empty prefix and short order arguments at compile time', function (scope) {
            const loadUser = testDouble<LoadUser>();

            scope.assert(
                rejectsCall('no-matching-overload'),
                async function () {
                    return assertFacade(doubleUsage.calledWithPrefix, loadUser, []);
                }
            );
            scope.assert(
                rejectsCall('no-matching-overload'),
                async function () {
                    return assertFacade(doubleUsage.callOrder, [ loadUser ]);
                }
            );
            scope.assert(
                rejectsCall('no-matching-overload'),
                async function () {
                    return assertFacade(doubleUsage.callCount, loadUser, '1');
                }
            );
            scope.assert(
                rejectsCall('no-matching-overload'),
                async function () {
                    return assertFacade(doubleUsage.yieldedExactly, loadUser, 'event');
                }
            );
            return scope.assert.collect();
        })
    ])
]);
