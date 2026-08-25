import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    answerFromBehavior,
    fallbackForInvocation,
    ruleMatches,
    type BehaviorRuntime,
    type Invocation
} from './double-behavior.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

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

async function collectAsyncValues(values: AsyncIterable<unknown>): Promise<readonly unknown[]> {
    return await Array.fromAsync(values);
}

function callInvocation(parameters: readonly unknown[], index: number): Invocation {
    return { arguments: parameters, index, kind: 'call' };
}

function constructionInvocation(parameters: readonly unknown[], index: number): Invocation {
    return { arguments: parameters, index, kind: 'construction' };
}

function behaviorRuntime(entries: readonly unknown[]): BehaviorRuntime {
    let index = 0;

    return {
        nextSequenceEntry() {
            const entry = entries[index];
            index += 1;

            return entry;
        },
        trackAsyncIterator() {
            throw new TypeError('Unexpected async iterator tracking.');
        },
        trackSyncIterator() {
            throw new TypeError('Unexpected iterator tracking.');
        }
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/doubles/test-double.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'testDouble() creates an untyped callable double',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const anyValue = testDouble();

                scope.assert.equal(anyValue('ignored'), undefined);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'testDouble.returns() creates a fixed-return double',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const loadValue = testDouble.returns(42);

                scope.assert.equal(loadValue('ignored'), 42);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'testDouble.resolves() creates a fixed-resolution double',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadValue = testDouble.resolves('value');

                scope.assert.equal(await loadValue('ignored'), 'value');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'testDouble.rejects() creates a fixed-rejection double',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const error = new Error('expected');
                const loadValue = testDouble.rejects(error);

                await scope.assert.rejects(async function rejectValue() {
                    await loadValue('ignored');
                }, { exact: error });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'testDouble.throws() creates a fixed-throw double',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const error = new Error('expected');
                const loadValue = testDouble.throws(error);

                scope.assert.throws(function throwValue() {
                    loadValue('ignored');
                }, { exact: error });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'testDouble.constructs() creates a fixed-construction double',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type ClientInstance = {
                    readonly id: string;
                };

                const client: ClientInstance = { id: 'client' };
                const Client = testDouble.constructs(client);

                scope.assert.equal(new Client('ignored'), client);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'answerFromBehavior() handles modes and sequence fallthrough',
            metadata: {},
            body(scope: OverkillScope) {
                const call = callInvocation([ 'match' ], 0);
                const construction = constructionInvocation([], 0);
                const callBehavior = rule.returns('value');

                scope.assert.deepEqual(answerFromBehavior(callBehavior, construction, behaviorRuntime([])), {
                    answered: false
                });
                scope.assert.deepEqual(
                    answerFromBehavior(rule.sequence([ 'value', 'unused' ]), call, behaviorRuntime([])),
                    {
                        answered: false
                    }
                );
                scope.assert.deepEqual(
                    answerFromBehavior(rule.sequence([ 'value', 'unused' ]), call, behaviorRuntime([ 'value' ])),
                    {
                        answered: true,
                        value: 'value'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'ruleMatches() handles invocation kind, argument, and index criteria',
            metadata: {},
            body(scope: OverkillScope) {
                const argumentRule = rule.when({ id: 'expected' }).returns('value');
                const indexRule = rule.onCall(1).returns('value');

                scope.assert.equal(ruleMatches(argumentRule, constructionInvocation([ { id: 'expected' } ], 0)), false);
                scope.assert.equal(ruleMatches(argumentRule, callInvocation([], 0)), false);
                scope.assert.equal(
                    ruleMatches(argumentRule, callInvocation([ { id: 'expected', extra: true } ], 0)),
                    true
                );
                scope.assert.equal(ruleMatches(indexRule, callInvocation([ 'ignored' ], 0)), false);
                scope.assert.equal(ruleMatches(indexRule, callInvocation([ 'ignored' ], 1)), true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'fallbackForInvocation() selects direct and invocation-specific fallbacks',
            metadata: {},
            body(scope: OverkillScope) {
                const directFallback = rule.returns('direct');
                const callFallback = rule.returns('call');

                scope.assert.equal(fallbackForInvocation(directFallback, callInvocation([], 0)), directFallback);
                scope.assert.equal(fallbackForInvocation({ call: callFallback }, callInvocation([], 0)), callFallback);
                scope.assert.equal(fallbackForInvocation({ call: callFallback }, constructionInvocation([], 0)), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'rule fixed behavior markers expose direct results',
            metadata: {},
            async body(scope: OverkillScope) {
                const error = new Error('expected');
                const client = { id: 'client' };

                scope.assert.equal(rule.returns('value').result(), 'value');
                scope.assert.equal(await rule.resolves('value').result(), 'value');
                scope.assert.equal(rule.constructs(client).result(), client);
                await scope.assert.rejects(async function rejectRuleResult() {
                    await rule.rejects(error).result();
                }, { exact: error });
                scope.assert.throws(function throwRuleResult() {
                    rule.throws(error).result();
                }, { exact: error });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'rule generator markers expose result iterators and guarded markers',
            metadata: {},
            async body(scope: OverkillScope) {
                const values = rule.yields([ 'a', 'b' ], 'done').result();
                const asyncValues = rule.yieldsAsync([ 'c', 'd' ], 'done').result();

                scope.assert.deepEqual(Array.from(values), [ 'a', 'b' ]);
                scope.assert.deepEqual(await collectAsyncValues(asyncValues), [ 'c', 'd' ]);
                scope.assert.throws(function callRuleMarker() {
                    rule
                        .calls(function answer() {
                            return 'value';
                        })
                        .result();
                }, { message: 'calls result marker should not be called.' });
                scope.assert.throws(function sequenceRuleMarker() {
                    rule.sequence([ 'a', 'b' ]).result();
                }, { message: 'sequence result marker should not be called.' });
                scope.assert.throws(function yieldsFromRuleMarker() {
                    rule
                        .yieldsFrom(function* yieldValues() {
                            yield 'value';
                        })
                        .result();
                }, { message: 'yieldsFrom result marker should not be called.' });
                scope.assert.throws(function yieldsAsyncFromRuleMarker() {
                    rule
                        .yieldsAsyncFrom(async function* yieldAsyncValues() {
                            yield 'value';
                        })
                        .result();
                }, { message: 'yieldsAsyncFrom result marker should not be called.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'created doubles reject wrong invocation modes',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const loadValue = testDouble.returns('value');
                const Client = testDouble.constructs({ id: 'client' });
                const LoadValue = loadValue as unknown as new () => unknown;

                scope.assert.throws(function constructCallableDouble() {
                    scope.assert.equal(new LoadValue(), undefined);
                }, { message: /not a constructor/u });
                scope.assert.throws(function callConstructorDouble() {
                    (Client as unknown as () => unknown)();
                }, { message: /Class constructor/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'testDouble.constructs() rejects primitive instances at runtime',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const createConstructorDouble = testDouble.constructs as unknown as PrimitiveConstructionFactory;

                scope.assert.throws(function constructPrimitive() {
                    createConstructorDouble(1);
                }, { message: /requires an object instance/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'rule.when() matches partial-deep argument prefixes',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type LoadUser = (query: UserQuery, scope: string) => User;

                const adminUser = { id: 'admin' };
                const guestUser = { id: 'guest' };
                const loadUser = testDouble<LoadUser>({
                    rules: [
                        rule.when({ id: 'admin' }).returns(adminUser),
                        rule.when({ profile: { role: 'guest' } }, 'read').returns(guestUser)
                    ]
                });

                scope.assert.equal(loadUser({ id: 'admin', profile: { role: 'owner' } }, 'write'), adminUser);
                scope.assert.equal(loadUser({ id: 'guest-id', profile: { role: 'guest' } }, 'read'), guestUser);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'rule.whenConstructedWith() matches partial-deep constructor argument prefixes',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type ClientConstructor = new (options: ClientOptions, retries: number) => ClientWithId;

                const client = { id: 'primary' };
                const Client = testDouble<ClientConstructor>({
                    rules: [
                        rule.whenConstructedWith({ auth: { token: 'primary' } }).constructs(client)
                    ]
                });

                scope.assert.equal(
                    new Client({ auth: { token: 'primary' }, baseUrl: 'https://api.example.test' }, 3),
                    client
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'ordered call rules use zero-based indexes',
            metadata: {},
            body(scope: OverkillScope) {
                type LoadValue = () => string;

                const loadValue = testDouble<LoadValue>({
                    rules: [
                        rule.onCall(1).returns('second'),
                        rule.onCall(0).returns('first')
                    ]
                });

                scope.assert.equal(loadValue(), 'first');
                scope.assert.equal(loadValue(), 'second');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'ordered construction rules use zero-based indexes',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type ClientConstructor = new () => ClientWithId;

                const firstClient = { id: 'first' };
                const secondClient = { id: 'second' };
                const clientConstructor = testDouble<ClientConstructor>({
                    rules: [
                        rule.onConstruction(1).constructs(secondClient),
                        rule.onConstruction(0).constructs(firstClient)
                    ]
                });

                scope.assert.equal(Reflect.construct(clientConstructor, []), firstClient);
                scope.assert.equal(Reflect.construct(clientConstructor, []), secondClient);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'rules are evaluated in order and exhausted sequences fall through',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type LoadValue = (id: string) => string;

                const loadValue = testDouble<LoadValue>({
                    rules: [
                        rule.when('fixed').returns('first match'),
                        rule.when('fixed').returns('later match'),
                        rule.when('sequenced').sequence([ 'a', 'b' ]),
                        rule.when('sequenced').returns('after sequence')
                    ]
                });

                scope.assert.equal(loadValue('fixed'), 'first match');
                scope.assert.equal(loadValue('sequenced'), 'a');
                scope.assert.equal(loadValue('sequenced'), 'b');
                scope.assert.equal(loadValue('sequenced'), 'after sequence');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'rule.sequence() treats raw array values as returns entries',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type LoadValue = () => string;

                const loadValue = testDouble<LoadValue>({
                    fallback: rule.sequence([ 'a', 'b' ])
                });

                scope.assert.equal(loadValue(), 'a');
                scope.assert.equal(loadValue(), 'b');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'rule.sequence() supports async behavior entries',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                type LoadValue = () => Promise<string>;

                const loadValue = testDouble<LoadValue>({
                    fallback: rule.sequence([
                        rule.resolves('a'),
                        rule.resolves('b')
                    ])
                });

                scope.assert.equal(await loadValue(), 'a');
                scope.assert.equal(await loadValue(), 'b');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'fallback can configure call and construction defaults together',
            metadata: {},
            body: function body(scope: OverkillScope) {
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

                scope.assert.equal(clientFactory('https://api.example.test'), calledClient);
                scope.assert.equal(Reflect.construct(clientFactory, [ 'https://api.example.test' ]), constructedClient);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'answer receives invocation arguments, index, and kind',
            metadata: {},
            body: function body(scope: OverkillScope) {
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

                scope.assert.equal(clientFactory('a'), '0:a');
                scope.assert.equal(clientFactory('b'), '1:b');
                scope.assert.equal(Reflect.construct(clientFactory, [ 'c' ]), constructedClient);
                scope.assert.deepEqual(seen, [
                    { arguments: [ 'a' ], index: 0, kind: 'call' },
                    { arguments: [ 'b' ], index: 1, kind: 'call' },
                    { arguments: [ 'c' ], index: 0, kind: 'construction' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'ordered rules reject invalid indexes at runtime',
            metadata: {},
            body: function body(scope: OverkillScope) {
                scope.assert.throws(function createNegativeCallRule() {
                    rule.onCall(-1);
                }, { message: /non-negative integer/u });
                scope.assert.throws(function createFractionalConstructionRule() {
                    rule.onConstruction(1.5);
                }, { message: /non-negative integer/u });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'configured doubles throw TypeError when no behavior can answer',
            metadata: {},
            body: function body(scope: OverkillScope) {
                type LoadValue = (id: string) => string;

                const loadValue = testDouble<LoadValue>({
                    rules: [ rule.when('known').returns('value') ]
                });

                scope.assert.throws(function loadUnknownValue() {
                    loadValue('unknown');
                }, { message: /no configured behavior/u });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
