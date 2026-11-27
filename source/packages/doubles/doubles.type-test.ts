import { suite, test } from '@overkill-dev/test-type-authoring';
import { acceptsCall, assignableFrom, assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import type { AssertAssertionFacade } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('./doubles.entry-point.ts', [
    suite('fixed doubles', [
        test('creates an untyped default double', function (typeScope) {
            const value = testDouble();

            typeScope.assert(sameType.withActual<TestDouble<(...arguments_: readonly unknown[]) => unknown>>(), value);
            typeScope.assert(sameType.withActual<unknown>(), value('id'));
            return typeScope.assert.collect();
        }),
        test('preserves explicit default double signatures', function (typeScope) {
            const typed = testDouble<LoadUser>();

            typeScope.assert(sameType.withActual<TestDouble<LoadUser>>(), typed);
            return typeScope.assert.collect();
        }),
        test('allows calls matching explicit default double signatures', function (typeScope) {
            const typed = testDouble<LoadUser>();

            typeScope.assert(acceptsCall, () => typed('1', false));
            return typeScope.assert.collect();
        }),
        test('creates fixed-return doubles', function (typeScope) {
            const untyped = testDouble.returns(user);
            const typed = testDouble.returns<LoadUser>(user);

            typeScope.assert(sameType.withActual<TestDouble<(...arguments_: readonly unknown[]) => User>>(), untyped);
            typeScope.assert(sameType.withActual<TestDouble<LoadUser>>(), typed);
            typeScope.assert(acceptsCall, () => typed('1', false));
            typeScope.assert(rejectsCall('argument-type'), () => typed(1, false));
            typeScope.assert(sameType.withActual<User>(), typed('1', false));
            return typeScope.assert.collect();
        }),
        test('creates fixed void-return doubles', function (typeScope) {
            const voidCallback = testDouble.returns<() => void>();

            typeScope.assert(sameType.withActual<TestDouble<() => void>>(), voidCallback);
            return typeScope.assert.collect();
        }),
        test('creates fixed-resolution doubles', function (typeScope) {
            const untyped = testDouble.resolves(user);
            const typed = testDouble.resolves<SaveUser>(user);

            typeScope.assert(
                sameType.withActual<TestDouble<(...arguments_: readonly unknown[]) => Promise<User>>>(),
                untyped
            );
            typeScope.assert(sameType.withActual<TestDouble<SaveUser>>(), typed);
            typeScope.assert(acceptsCall, async () => typed(user));
            typeScope.assert(rejectsCall('argument-type'), async () => typed('user'));
            typeScope.assert(sameType.withActual<Promise<User>>(), typed(user));
            typeScope.assert(rejectsCall('argument-type'), () => testDouble.resolves<LoadUser>(user));
            return typeScope.assert.collect();
        }),
        test('creates fixed-rejection doubles', function (typeScope) {
            const untyped = testDouble.rejects(new Error('expected'));
            const typed = testDouble.rejects<SaveUser>(new Error('expected'));

            typeScope.assert(
                sameType.withActual<TestDouble<(...arguments_: readonly unknown[]) => Promise<never>>>(),
                untyped
            );
            typeScope.assert(sameType.withActual<TestDouble<SaveUser>>(), typed);
            typeScope.assert(acceptsCall, async () => typed(user));
            typeScope.assert(sameType.withActual<Promise<User>>(), typed(user));
            typeScope.assert(rejectsCall('argument-type'), () => testDouble.rejects<LoadUser>(new Error('expected')));
            return typeScope.assert.collect();
        }),
        test('creates fixed-throw doubles', function (typeScope) {
            const untyped = testDouble.throws(new Error('expected'));
            const typed = testDouble.throws<LoadUser>(new Error('expected'));

            typeScope.assert(sameType.withActual<TestDouble<(...arguments_: readonly unknown[]) => never>>(), untyped);
            typeScope.assert(sameType.withActual<TestDouble<LoadUser>>(), typed);
            typeScope.assert(acceptsCall, () => typed('1', false));
            typeScope.assert(sameType.withActual<User>(), typed('1', false));
            typeScope.assert(rejectsCall('argument-type'), () => testDouble.throws<SaveUser>(new Error('expected')));
            return typeScope.assert.collect();
        }),
        test('creates fixed-construction doubles', function (typeScope) {
            const untyped = testDouble.constructs(client);
            const TypedClient = testDouble.constructs<ClientConstructor>(client);

            typeScope.assert(
                sameType.withActual<TestDouble<new (...arguments_: readonly unknown[]) => Client>>(),
                untyped
            );
            typeScope.assert(sameType.withActual<TestDouble<ClientConstructor>>(), TypedClient);
            typeScope.assert(sameType.withActual<Client>(), new TypedClient('https://api.example.test'));
            return typeScope.assert.collect();
        })
    ]),
    suite('fixed generator doubles', [
        test('creates fixed sync generator doubles', function (typeScope) {
            const untyped = testDouble.yields([ 'created' ]);
            const typed = testDouble.yields<LoadEvents>([ 'created' ], 1);

            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestDouble<(...arguments_: readonly unknown[]) => Generator<string, undefined, unknown>>>()(
                    untyped
                )
            );
            typeScope.assert(sameType.withActual<TestDouble<LoadEvents>>(), typed);
            typeScope.assert(acceptsCall, () => typed('1'));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<Generator<string, number, boolean>>()(typed('1')));
            return typeScope.assert.collect();
        }),
        test('creates fixed sync generator doubles from sources', function (typeScope) {
            const fromSource = testDouble.yieldsFrom<LoadEvents>(function* loadEvents(id) {
                yield id;
                return 1;
            });

            typeScope.assert(sameType.withActual<TestDouble<LoadEvents>>(), fromSource);
            return typeScope.assert.collect();
        }),
        test('rejects non-generator fixed sync generator doubles', function (typeScope) {
            typeScope.assert(rejectsCall('no-matching-overload'), () => testDouble.yields<LoadUser>([ 'event' ]));
            typeScope.assert(rejectsCall('argument-type'), () => testDouble.yields<LoadEvents>([ 'event' ], 'done'));
            return typeScope.assert.collect();
        }),
        test('creates fixed async generator doubles', function (typeScope) {
            const untyped = testDouble.yieldsAsync([ 'created' ]);
            const typed = testDouble.yieldsAsync<LoadAsyncEvents>([ 'created' ], 1);

            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<
                    TestDouble<(...arguments_: readonly unknown[]) => AsyncGenerator<string, undefined, unknown>>
                >()(untyped)
            );
            typeScope.assert(sameType.withActual<TestDouble<LoadAsyncEvents>>(), typed);
            typeScope.assert(acceptsCall, () => typed('1'));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<AsyncGenerator<string, number, boolean>>()(typed('1'))
            );
            return typeScope.assert.collect();
        }),
        test('creates fixed async generator doubles from sources', function (typeScope) {
            const fromAsyncSource = testDouble.yieldsAsyncFrom<LoadAsyncEvents>(async function* loadEvents(id) {
                yield id;
                return 1;
            });
            const fromSyncSource = testDouble.yieldsAsyncFrom<LoadAsyncEvents>(function* loadEvents(id) {
                yield id;
                return 1;
            });

            typeScope.assert(sameType.withActual<TestDouble<LoadAsyncEvents>>(), fromAsyncSource);
            typeScope.assert(sameType.withActual<TestDouble<LoadAsyncEvents>>(), fromSyncSource);
            return typeScope.assert.collect();
        }),
        test('rejects non-generator fixed async generator doubles', function (typeScope) {
            typeScope.assert(rejectsCall('no-matching-overload'), () => testDouble.yieldsAsync<LoadUser>([ 'event' ]));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => testDouble.yieldsAsync<LoadAsyncEvents>([ 'event' ], 'done')
            );
            return typeScope.assert.collect();
        })
    ]),
    suite('history types', [
        test('exposes typed history counts and reset on callable doubles', function (typeScope) {
            const loadUser = testDouble<LoadUser>();

            typeScope.assert(assignableTo.withActual<DoubleHistory<LoadUser>>(), loadUser);
            typeScope.assert(sameType.withActual<number>(), loadUser.callCount);
            typeScope.assert(sameType.withActual<number>(), loadUser.interactionCount);
            typeScope.assert(sameType.withActual<() => void>(), loadUser.reset);
            typeScope.assert(rejectsCall('argument-count'), () => loadUser.reset('history'));
            return typeScope.assert.collect();
        }),
        test('exposes typed call history records', function (typeScope) {
            const loadUser = testDouble<LoadUser>();
            const scopedLoadUser = testDouble<ScopedLoadUser>();
            const saveUser = testDouble<SaveUser>();

            typeScope.assert(sameType.withActual<readonly DoubleCall<Parameters<LoadUser>, User>[]>(), loadUser.calls);
            typeScope.assert(sameType.withActual<DoubleCall<Parameters<LoadUser>, User> | null>(), loadUser.firstCall);
            typeScope.assert(sameType.withActual<DoubleCall<Parameters<LoadUser>, User> | null>(), loadUser.lastCall);
            typeScope.assert(sameType.withActual<DoubleCall<Parameters<LoadUser>, User> | null>(), loadUser.nthCall(0));
            typeScope.assert(
                sameType.withActual<DoubleCall<Parameters<ScopedLoadUser>, User, ScopeReceiver> | null>(),
                scopedLoadUser.firstCall
            );
            typeScope.assert(sameType.withActual<DoubleResult<Promise<User>> | null>(), saveUser.firstResult);
            return typeScope.assert.collect();
        }),
        test('exposes typed iterator history records', function (typeScope) {
            const loadEvents = testDouble.yields<LoadEvents>([ 'created' ], 1);
            const plain = testDouble.returns<LoadUser>(user);

            typeScope.assert(sameType.withActual<number>(), loadEvents.iteratorEventCount);
            typeScope.assert(
                sameType.withActual<readonly DoubleIteratorEvent<string, number, LoadEventProtocolArguments>[]>(),
                loadEvents.iteratorEvents
            );
            typeScope.assert(
                sameType.withActual<DoubleIteratorEvent<string, number, LoadEventProtocolArguments> | null>(),
                loadEvents.firstIteratorEvent
            );
            typeScope.assert(
                sameType.withActual<DoubleIteratorEvent<string, number, LoadEventProtocolArguments> | null>(),
                loadEvents.nthIteratorEvent(0)
            );
            typeScope.assert(sameType.withActual<DoubleIteratorEvent | null>(), plain.firstIteratorEvent);
            return typeScope.assert.collect();
        }),
        test('exposes typed construction and aggregate interaction history', function (typeScope) {
            const Client = testDouble<ClientConstructor>({
                fallback: rule.constructs(client)
            });
            const ClientFactoryDouble = testDouble<ClientFactory>({
                fallback: {
                    call: rule.returns(client),
                    construction: rule.constructs(client)
                }
            });

            typeScope.assert(
                sameType.withActual<readonly DoubleConstruction<ConstructorParameters<ClientConstructor>, Client>[]>(),
                Client.constructions
            );
            typeScope.assert(
                sameType.withActual<DoubleConstruction<ConstructorParameters<ClientConstructor>, Client> | null>(),
                Client.firstConstruction
            );
            typeScope.assert(
                sameType.withActual<ExpectedClientFactoryInteraction>(),
                ClientFactoryDouble.firstInteraction
            );
            typeScope.assert(
                sameType.withActual<ExpectedClientFactoryInteraction>(),
                ClientFactoryDouble.nthInteraction(0)
            );
            return typeScope.assert.collect();
        }),
        test('preserves overloads in history records up to the supported cap', function (typeScope) {
            const loadValue = testDouble<OverloadedLoad>();
            const Client = testDouble<OverloadedClientConstructor>({
                fallback: rule.constructs(clientWithTimeout)
            });

            typeScope.assert(sameType.withActual<ExpectedOverloadedCall>(), loadValue.firstCall);
            typeScope.assert(sameType.withActual<ExpectedOverloadedConstruction>(), Client.firstConstruction);
            return typeScope.assert.collect();
        })
    ]),
    suite('double usage assertions', [
        test('exports assertion references under one namespace', function (typeScope) {
            typeScope.assert(assignableTo.withActual<unknown>(), doubleUsage.calledOnceWith);
            typeScope.assert(assignableFrom<keyof typeof doubleUsage, 'calledWithExactly'>());
            typeScope.assert(assignableFrom<keyof typeof doubleUsage, 'yieldedExactly'>());
            typeScope.assert(assignableFrom<keyof typeof doubleUsage, 'interactionOrder'>());
            typeScope.assert(assignableFrom.not<keyof typeof doubleUsage, 'returnedWith'>());
            return typeScope.assert.collect();
        }),
        suite('accepts doubles through the engine assert facade', [
            test('counts interactions and matches calls', function (typeScope) {
                const loadUser = testDouble<LoadUser>();
                const Client = testDouble<ClientConstructor>({
                    fallback: rule.constructs(client)
                });
                typeScope.assert(acceptsCall, () => assertFacade(doubleUsage.called, loadUser));
                typeScope.assert(acceptsCall, () => assertFacade(doubleUsage.calledWith, loadUser, [ '1', false ]));
                typeScope.assert(
                    acceptsCall,
                    () => assertFacade(doubleUsage.calledWithExactly, loadUser, [ '1', false ])
                );
                typeScope.assert(acceptsCall, () => assertFacade(doubleUsage.calledWithPrefix, loadUser, [ '1' ]));
                typeScope.assert(acceptsCall, () => assertFacade(doubleUsage.nthCallWith, loadUser, 0, [ '1', false ]));
                typeScope.assert(
                    acceptsCall,
                    () => assertFacade(doubleUsage.constructedWith, Client, [ 'https://api.example.test' ])
                );
                return typeScope.assert.collect();
            }),
            test('matches invocation and result evidence', function (typeScope) {
                const loadUser = testDouble<LoadUser>();
                typeScope.assert(acceptsCall, () => assertFacade(doubleUsage.callCount, loadUser, 1));
                typeScope.assert(
                    acceptsCall,
                    () => assertFacade(doubleUsage.callOrder, [ loadUser, testDouble<LoadUser>() ])
                );
                return typeScope.assert.collect();
            })
        ]),
        test('accepts generator doubles through the engine assert facade', function (typeScope) {
            typeScope.assert(
                acceptsCall,
                () => assertFacade(doubleUsage.yieldedExactly, testDouble.yields([ 'event' ]), [ 'event' ])
            );
            return typeScope.assert.collect();
        }),
        test('rejects empty prefix and short order arguments at compile time', function (typeScope) {
            const loadUser = testDouble<LoadUser>();

            typeScope.assert(
                rejectsCall('no-matching-overload'),
                async () => assertFacade(doubleUsage.calledWithPrefix, loadUser, [])
            );
            typeScope.assert(
                rejectsCall('no-matching-overload'),
                async () => assertFacade(doubleUsage.callOrder, [ loadUser ])
            );
            typeScope.assert(
                rejectsCall('no-matching-overload'),
                async () => assertFacade(doubleUsage.callCount, loadUser, '1')
            );
            typeScope.assert(
                rejectsCall('no-matching-overload'),
                async () => assertFacade(doubleUsage.yieldedExactly, loadUser, 'event')
            );
            return typeScope.assert.collect();
        })
    ])
]);
