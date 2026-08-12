import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type {
    FailedCheck,
    FailedCompositeCheck
} from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { AssertionTestFailure, FailOutcome, RunResult } from '../engine/run-result.ts';
import type { TestBody, TestScope } from '../engine/test-node.ts';
import { doubleUsage } from './double-usage.ts';
import { testDouble } from './test-double.ts';

type User = {
    readonly id: string;
    readonly name: string;
};
type LoadOptions = {
    readonly role: string;
    readonly trace: string;
};
type LoadUser = (id: string, options: LoadOptions) => User;
type Ping = () => string;
type Client = {
    readonly id: string;
};
type ClientOptions = {
    readonly timeout: number;
    readonly token: string;
};
type ClientConstructor = new (url: string, options: ClientOptions) => Client;

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        body,
                        metadata: {},
                        name: 'case'
                    })
                ],
                metadata: {},
                name: 'root'
            })
        )
    );
}

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome.kind === 'fail') {
        return firstResult.outcome;
    }

    return null;
}

function firstAssertionFailure(result: RunResult): AssertionTestFailure | null {
    const outcome = firstFailOutcome(result);
    const failure = outcome?.failures[0];

    if (failure?.kind === 'assertion') {
        return failure;
    }

    return null;
}

function firstComposite(result: RunResult): FailedCompositeCheck | null {
    const check = firstAssertionFailure(result)?.checks[0];

    if (check?.kind === 'composite') {
        return check;
    }

    return null;
}

function childSummaries(check: FailedCompositeCheck): readonly string[] {
    return check.children.map(function summary(child) {
        return child.summary;
    });
}

function firstChild(check: FailedCompositeCheck): FailedCheck | null {
    return check.children[0];
}

function failureSummaries(result: RunResult): readonly string[] | null {
    const failure = firstAssertionFailure(result);

    if (failure === null) {
        return null;
    }

    return failure.checks.map(function summary(check) {
        return check.summary;
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/doubles/double-usage.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'doubleUsage call count and mode assertions pass through scope.assert()',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('42', { role: 'admin', trace: 'trace-id' });

                    testScope.assert(doubleUsage.called, loadUser);
                    testScope.assert(doubleUsage.calledOnce, loadUser);
                    testScope.assert(doubleUsage.callCount, loadUser, 1);
                    testScope.assert(doubleUsage.interacted, loadUser);
                    testScope.assert(doubleUsage.interactedOnce, loadUser);
                    testScope.assert(doubleUsage.interactionCount, loadUser, 1);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage construction count and mode assertions pass through scope.assert()',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const Client = testDouble.constructs<ClientConstructor>({ id: 'client' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    const client = new Client('https://api.example.test', { timeout: 500, token: 'primary' });

                    testScope.assert.equal(client.id, 'client');
                    testScope.assert(doubleUsage.constructed, Client);
                    testScope.assert(doubleUsage.constructedOnce, Client);
                    testScope.assert(doubleUsage.constructionCount, Client, 1);
                    testScope.assert(doubleUsage.interacted, Client);
                    testScope.assert(doubleUsage.interactedOnce, Client);
                    testScope.assert(doubleUsage.interactionCount, Client, 1);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage negative mode assertions produce domain summaries',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('42', { role: 'admin', trace: 'trace-id' });

                    testScope.assert(doubleUsage.notInteracted, loadUser);
                    return testScope.assert.collect();
                });
                const composite = firstComposite(result);
                scope.require.notNull(composite);
                const child = firstChild(composite);
                scope.require.notNull(child);

                scope.assert.deepEqual(
                    {
                        actual: child.actual,
                        childSummaries: childSummaries(composite),
                        expected: child.expected,
                        summary: composite.summary
                    },
                    {
                        actual: serializeValue(1),
                        childSummaries: [ 'interaction count' ],
                        expected: serializeValue(0),
                        summary: 'Expected double not to have interactions.'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage argument assertions support partial, prefix, and exact matching',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const user = { id: '42', name: 'Ada' };
                const loadUser = testDouble.returns<LoadUser>(user);
                const ping = testDouble.returns<Ping>('pong');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('42', { role: 'admin', trace: 'trace-id' });
                    ping();

                    testScope.assert(doubleUsage.calledWith, loadUser, [ '42', { role: 'admin' } ]);
                    testScope.assert(doubleUsage.calledWithPrefix, loadUser, [ '42' ]);
                    testScope.assert(doubleUsage.calledWithExactly, loadUser, [
                        '42',
                        { role: 'admin', trace: 'trace-id' }
                    ]);
                    testScope.assert(doubleUsage.calledWith, ping, []);
                    testScope.assert(doubleUsage.calledWithExactly, ping, []);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage iterator assertions pass through scope.assert()',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadEvents = testDouble.yields([ 'created', 'updated' ]);
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    const events = loadEvents();

                    events.next();
                    events.next();
                    events.next();
                    testScope.assert(doubleUsage.iterated, loadEvents);
                    testScope.assert(doubleUsage.iteratorEventCount, loadEvents, 3);
                    testScope.assert(doubleUsage.yieldCount, loadEvents, 2);
                    testScope.assert(doubleUsage.yieldedExactly, loadEvents, [ 'created', 'updated' ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage iterator assertions report protocol history failures',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadEvents = testDouble.yields([ 'created' ]);
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadEvents().next();

                    testScope.assert(doubleUsage.notIterated, loadEvents);
                    testScope.assert(doubleUsage.iteratorEventCount, loadEvents, 2);
                    testScope.assert(doubleUsage.yieldCount, loadEvents, 2);
                    testScope.assert(doubleUsage.yieldedExactly, loadEvents, [ 'updated' ]);
                    return testScope.assert.collect();
                });

                const summaries = failureSummaries(result);

                scope.require.notNull(summaries);
                scope.assert.deepEqual(summaries, [
                    'Expected double iterator not to have been consumed.',
                    'Expected double iterator event count to match.',
                    'Expected double yield count to match.',
                    'Expected double yielded values to match exactly.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage prefix assertions reject empty prefixes',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const ping = testDouble.returns<Ping>('pong');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    ping();

                    testScope.assert(
                        doubleUsage.calledWithPrefix as unknown as typeof doubleUsage.calledWith,
                        ping,
                        []
                    );
                    return testScope.assert.collect();
                });
                const composite = firstComposite(result);
                scope.require.notNull(composite);
                const child = firstChild(composite);
                scope.require.notNull(child);

                scope.assert.equal(composite.summary, 'Expected double call arguments to match.');
                scope.assert.equal(child.kind, 'foreign');
                scope.assert.equal(
                    child.summary,
                    'expected argument prefix: Expected argument prefix to contain at least one item.'
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage argument assertions distinguish exact arity from prefix arity',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('42', { role: 'admin', trace: 'trace-id' });

                    testScope.assert(doubleUsage.calledWith, loadUser, [ '42' ]);
                    return testScope.assert.collect();
                });
                const composite = firstComposite(result);
                scope.require.notNull(composite);

                scope.assert.equal(composite.summary, 'Expected double call arguments to match.');
                scope.assert.deepEqual(childSummaries(composite), [ 'call arguments' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage once, last, and nth argument assertions use the relevant mode history',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('first', { role: 'reader', trace: 'one' });
                    loadUser('second', { role: 'admin', trace: 'two' });

                    testScope.assert(doubleUsage.nthCallWith, loadUser, 0, [ 'first', { role: 'reader' } ]);
                    testScope.assert(doubleUsage.lastCalledWith, loadUser, [ 'second', { role: 'admin' } ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage argument assertion failures explain the matched position',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
                const ping = testDouble.returns<Ping>('pong');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('42', { role: 'admin', trace: 'trace-id' });

                    testScope.assert(doubleUsage.calledWithPrefix, loadUser, [ 'missing' ]);
                    testScope.assert(doubleUsage.calledWithExactly, loadUser, [ '42', {
                        role: 'reader',
                        trace: 'trace-id'
                    } ]);
                    testScope.assert(doubleUsage.calledWithExactly, loadUser, [ '42' ]);
                    testScope.assert(doubleUsage.lastCalledWith, ping, []);
                    testScope.assert(doubleUsage.lastCalledWithExactly, loadUser, [
                        '42',
                        { role: 'reader', trace: 'trace-id' }
                    ]);
                    testScope.assert(doubleUsage.lastCalledWithPrefix, loadUser, [ 'missing' ]);
                    return testScope.assert.collect();
                });

                const summaries = failureSummaries(result);

                scope.require.notNull(summaries);
                scope.assert.deepEqual(summaries, [
                    'Expected double call arguments to match.',
                    'Expected double call arguments to match.',
                    'Expected double call arguments to match.',
                    'Expected double call arguments to match.',
                    'Expected double call arguments to match.',
                    'Expected double call arguments to match.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'doubleUsage calledOnceWith requires one total call in that mode',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('first', { role: 'reader', trace: 'one' });
                    loadUser('second', { role: 'admin', trace: 'two' });

                    testScope.assert(doubleUsage.calledOnceWith, loadUser, [ 'first', { role: 'reader' } ]);
                    return testScope.assert.collect();
                });
                const composite = firstComposite(result);
                scope.require.notNull(composite);
                const child = firstChild(composite);
                scope.require.notNull(child);

                scope.assert.equal(composite.summary, 'Expected double call arguments to match.');
                scope.assert.deepEqual(child.actual, serializeValue(2));
                scope.assert.deepEqual(child.expected, serializeValue(1));

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
