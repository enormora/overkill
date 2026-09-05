import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { rule } from './double-rule.ts';
import { testDouble, type TestDouble } from './test-double.ts';

type ClientWithId = {
    readonly id: string;
};
type ClientWithIdConstructor = new (baseUrl: string) => ClientWithId;
type ClientFactoryDoubleSignature = {
    (baseUrl: string): ClientWithId;
    new (baseUrl: string): ClientWithId;
};
type ScopedReceiver = {
    readonly scope: string;
};
type LoadScopedValue = (this: ScopedReceiver, id: string) => string;
type RecordedScopedLoadValue = {
    readonly actual: string;
    readonly loadValue: TestDouble<LoadScopedValue>;
    readonly receiver: ScopedReceiver;
};
type RecordedClientConstructor = {
    readonly Client: TestDouble<ClientWithIdConstructor>;
    readonly actual: ClientWithId;
    readonly client: ClientWithId;
};
type RecordedClientFactory = {
    readonly calledClient: ClientWithId;
    readonly calledResult: ClientWithId;
    readonly clientFactoryDouble: TestDouble<ClientFactoryDoubleSignature>;
    readonly constructedClient: ClientWithId;
    readonly constructedResult: ClientWithId;
};

type RejectingLoadValue = (id: string) => Promise<never>;
type RejectedResultRecord = {
    readonly firstResult: TestDouble<RejectingLoadValue>['firstResult'];
    readonly loadValue: TestDouble<RejectingLoadValue>;
    readonly promise: Promise<never>;
};

function createRecordedScopedLoadValue(): RecordedScopedLoadValue {
    const receiver = { scope: 'test' };
    const loadValue = testDouble.returns<LoadScopedValue>('value');
    const actual = loadValue.call(receiver, 'a');

    return { actual, loadValue, receiver };
}

function createRecordedClientConstructor(): RecordedClientConstructor {
    const client = { id: 'client' };
    const Client = testDouble.constructs<ClientWithIdConstructor>(client);
    const actual = new Client('https://api.example.test');

    return { Client, actual, client };
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

    const calledResult = clientFactoryDouble('call');
    const constructedResult = Reflect.construct(clientFactoryDouble, [ 'construction' ]);

    return { calledClient, calledResult, clientFactoryDouble, constructedClient, constructedResult };
}

function createRejectedResultRecord(error: Error): RejectedResultRecord {
    const loadValue = testDouble.rejects<RejectingLoadValue>(error);
    const promise = loadValue('id');
    const { firstResult } = loadValue;

    return { firstResult, loadValue, promise };
}

export const testSuite = createOverkillSuite({
    title: 'source/doubles/test-double-history-runtime.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'doubles expose aggregate counts for returned calls',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const { loadValue } = createRecordedScopedLoadValue();

                scope.assert.equal(loadValue.interactionCount, 1);
                scope.assert.equal(loadValue.callCount, 1);
                scope.assert.equal(loadValue.constructionCount, 0);
                scope.assert.equal(loadValue.nthCall(1), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubles expose aggregate call history for returned calls',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const { actual, loadValue, receiver } = createRecordedScopedLoadValue();
                const { firstInteraction, firstCall } = loadValue;
                const nthCall = loadValue.nthCall(0);

                scope.require.notNull(firstInteraction);
                scope.require.notNull(firstCall);
                scope.require.notNull(nthCall);
                scope.assert.deepEqual(
                    {
                        actual,
                        arguments: firstCall.arguments,
                        index: firstCall.index,
                        interactionKind: firstInteraction.kind,
                        order: firstCall.order,
                        resultStatus: nthCall.result.status,
                        thisValue: firstCall.thisValue
                    },
                    {
                        actual: 'value',
                        arguments: [ 'a' ],
                        index: 0,
                        interactionKind: 'call',
                        order: 0,
                        resultStatus: 'returned',
                        thisValue: receiver
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubles expose returned call result history',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const { actual, loadValue } = createRecordedScopedLoadValue();
                const { lastResult } = loadValue;

                scope.assert.equal(actual, 'value');
                scope.require.notNull(lastResult);
                scope.assert.equal(lastResult.status, 'returned');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubles expose construction counts for returned constructions',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const { Client } = createRecordedClientConstructor();

                scope.assert.equal(Client.interactionCount, 1);
                scope.assert.equal(Client.callCount, 0);
                scope.assert.equal(Client.constructionCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubles expose construction history for returned constructions',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const { Client, actual, client } = createRecordedClientConstructor();
                const { firstConstruction, firstInteraction } = Client;

                scope.assert.equal(actual, client);
                scope.require.notNull(firstConstruction);
                scope.require.notNull(firstInteraction);
                scope.assert.deepEqual(firstConstruction.arguments, [ 'https://api.example.test' ]);
                scope.assert.equal(firstConstruction.instance, client);
                scope.assert.equal(firstConstruction.result.status, 'returned');
                scope.assert.equal(firstInteraction.kind, 'construction');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'aggregate history counts calls and constructions together',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const { calledClient, calledResult, clientFactoryDouble, constructedClient, constructedResult } =
                    createRecordedClientFactory();

                scope.assert.equal(calledResult, calledClient);
                scope.assert.equal(constructedResult, constructedClient);
                scope.assert.equal(clientFactoryDouble.interactionCount, 2);
                scope.assert.equal(clientFactoryDouble.callCount, 1);
                scope.assert.equal(clientFactoryDouble.constructionCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'aggregate history preserves chronological call and construction order',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const { calledClient, calledResult, clientFactoryDouble, constructedClient, constructedResult } =
                    createRecordedClientFactory();

                scope.assert.deepEqual(
                    {
                        calledResult,
                        constructedResult,
                        interactionKinds: clientFactoryDouble.interactions.map(function interactionKind(interaction) {
                            return interaction.kind;
                        }),
                        resultKinds: clientFactoryDouble.results.map(function resultKind(result) {
                            return result.invocationKind;
                        })
                    },
                    {
                        calledResult: calledClient,
                        constructedResult: constructedClient,
                        interactionKinds: [ 'call', 'construction' ],
                        resultKinds: [ 'call', 'construction' ]
                    }
                );
                const { firstResult, lastResult } = clientFactoryDouble;
                scope.require.notNull(firstResult);
                scope.require.notNull(lastResult);
                scope.assert.deepEqual(
                    {
                        firstOrder: firstResult.order,
                        lastOrder: lastResult.order
                    },
                    {
                        firstOrder: 0,
                        lastOrder: 1
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'history records thrown calls',
            metadata: {},
            body(scope: OverkillScope) {
                type LoadValue = (id: string) => string;

                const expected = new Error('expected');
                const throwingLoadValue = testDouble.throws<LoadValue>(expected);

                scope.assert.throws(function throwConfiguredError() {
                    throwingLoadValue('id');
                }, { exact: expected });

                scope.assert.equal(throwingLoadValue.firstResult?.status, 'threw');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'history records missing behavior',
            metadata: {},
            body(scope: OverkillScope) {
                type LoadValue = (id: string) => string;

                const missingLoadValue = testDouble<LoadValue>({
                    rules: [ rule.when('known').returns('value') ]
                });

                scope.assert.throws(function throwMissingBehavior() {
                    missingLoadValue('unknown');
                }, { message: /no configured behavior/u });

                scope.assert.equal(missingLoadValue.firstResult?.status, 'threw');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'history records unsupported invocation modes',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const Client = testDouble.constructs({ id: 'client' });

                scope.assert.throws(function callConstructorDouble() {
                    (Client as unknown as () => unknown)();
                }, { message: /Class constructor/u });

                scope.assert.equal(Client.firstCall?.result.status, 'threw');
                scope.assert.equal(Client.callCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'history records thrown constructions with null instances',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type ClientConstructor = new () => ClientWithId;

                const error = new Error('expected');
                const Client = testDouble<ClientConstructor>({
                    fallback: rule.throws(error)
                });

                scope.assert.throws(function constructClientForHistory() {
                    Reflect.construct(Client, []);
                }, { exact: error });

                scope.assert.equal(Client.constructionCount, 1);
                const { firstConstruction } = Client;
                scope.require.notNull(firstConstruction);
                scope.assert.equal(firstConstruction.instance, null);
                scope.assert.equal(firstConstruction.result.status, 'threw');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'promise results are recorded immediately without awaiting settlement',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const error = new Error('expected');
                const { firstResult, loadValue, promise } = createRejectedResultRecord(error);

                scope.require.notNull(firstResult);
                scope.require.hasProperty(firstResult, 'value');
                await scope.assert.rejects(async function awaitRejectedValue() {
                    await promise;
                }, { exact: error });
                scope.assert.deepEqual(
                    {
                        firstStatus: firstResult.status,
                        retainedStatus: loadValue.firstResult?.status,
                        value: firstResult.value
                    },
                    {
                        firstStatus: 'returned',
                        retainedStatus: 'returned',
                        value: promise
                    }
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
