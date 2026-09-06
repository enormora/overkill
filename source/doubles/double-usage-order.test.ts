import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type {
    FailedCheck,
    FailedCompositeCheck
} from '../assertion-protocol/assertion-node-shape.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { AssertionTestFailure, FailOutcome, RunResult } from '../engine/run-result.ts';
import type { TestBody, TestScope } from '../engine/test-node.ts';
import { doubleUsage } from './double-usage.ts';
import { rule } from './double-rule.ts';
import { createTestDoubleScope, testDouble } from './test-double.ts';

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
                        title: 'case'
                    })
                ],
                metadata: {},
                title: 'root'
            })
        )
    );
}

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome?.kind === 'fail') {
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
    title: 'source/doubles/double-usage-order.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'doubleUsage construction argument assertions use construction history',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const Client = testDouble<ClientConstructor>({
                    fallback: rule.constructs({ id: 'client' })
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    const client = new Client('https://api.example.test', { timeout: 500, token: 'primary' });

                    testScope.assert.equal(client.id, 'client');
                    testScope.assert(doubleUsage.constructedOnceWith, Client, [
                        'https://api.example.test',
                        { token: 'primary' }
                    ]);
                    testScope.assert(doubleUsage.constructedWithPrefix, Client, [ 'https://api.example.test' ]);
                    testScope.assert(doubleUsage.constructedWithExactly, Client, [
                        'https://api.example.test',
                        { timeout: 500, token: 'primary' }
                    ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage indexed argument assertions validate index and event presence',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    loadUser('first', { role: 'reader', trace: 'one' });

                    testScope.assert(doubleUsage.nthCallWith, loadUser, -1, [ 'first' ]);
                    testScope.assert(doubleUsage.nthCallWith, loadUser, 3, [ 'first' ]);
                    testScope.assert(
                        doubleUsage.nthCallWithPrefix as unknown as typeof doubleUsage.nthCallWith,
                        loadUser,
                        0,
                        []
                    );
                    return testScope.assert.collect();
                });

                const summaries = failureSummaries(result);

                scope.require.notNull(summaries);
                scope.assert.deepEqual(summaries, [
                    'Expected indexed double call arguments to match.',
                    'Expected indexed double call arguments to match.',
                    'Expected indexed double call arguments to match.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage order assertions compare events across doubles from one scope',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const { testDouble: scopedDouble } = createTestDoubleScope();
                const first = scopedDouble.returns<Ping>('first');
                const second = scopedDouble.returns<Ping>('second');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    first();
                    second();

                    testScope.assert(doubleUsage.callOrder, [ first, second ]);
                    testScope.assert(doubleUsage.interactionOrder, [ first, second ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage construction order compares constructor events',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const { testDouble: scopedDouble } = createTestDoubleScope();
                const First = scopedDouble.constructs<ClientConstructor>({ id: 'first' });
                const Second = scopedDouble.constructs<ClientConstructor>({ id: 'second' });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    const first = new First('https://first.example.test', { timeout: 500, token: 'first' });
                    const second = new Second('https://second.example.test', { timeout: 500, token: 'second' });

                    testScope.assert.equal(first.id, 'first');
                    testScope.assert.equal(second.id, 'second');
                    testScope.assert(doubleUsage.constructionOrder, [ First, Second ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage order assertions require all previous events before the next double',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const { testDouble: scopedDouble } = createTestDoubleScope();
                const first = scopedDouble.returns<Ping>('first');
                const second = scopedDouble.returns<Ping>('second');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    first();
                    second();
                    first();

                    testScope.assert(doubleUsage.callOrder, [ first, second ]);
                    return testScope.assert.collect();
                });
                const composite = firstComposite(result);
                scope.require.notNull(composite);

                scope.assert.equal(composite.summary, 'Expected double call order to match.');
                scope.assert.deepEqual(childSummaries(composite), [ 'call order 0 before 1' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage order assertions reject invalid and unused order inputs',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const { testDouble: scopedDouble } = createTestDoubleScope();
                const first = scopedDouble.returns<Ping>('first');
                const second = scopedDouble.returns<Ping>('second');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    first();

                    testScope.assert(doubleUsage.callOrder as unknown as typeof doubleUsage.called, [ first ]);
                    testScope.assert(doubleUsage.callOrder, [ first, second ]);
                    testScope.assert(doubleUsage.callOrder, [ first, function notADouble() {
                        return undefined;
                    } ]);
                    return testScope.assert.collect();
                });

                const summaries = failureSummaries(result);

                scope.require.notNull(summaries);
                scope.assert.deepEqual(summaries, [
                    'Expected double call order to match.',
                    'Expected double call order to match.',
                    'Expected double call order to match.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage order assertions reject mixed double scopes',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const [ firstScope, secondScope ] = [ createTestDoubleScope(), createTestDoubleScope() ];
                const first = firstScope.testDouble.returns<Ping>('first');
                const second = secondScope.testDouble.returns<Ping>('second');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    first();
                    second();

                    testScope.assert(doubleUsage.callOrder, [ first, second ]);
                    return testScope.assert.collect();
                });
                const composite = firstComposite(result);
                scope.require.notNull(composite);
                const child = firstChild(composite);
                scope.require.notNull(child);

                scope.assert.deepEqual(
                    {
                        childKind: child.kind,
                        childSummary: child.summary,
                        summary: composite.summary
                    },
                    {
                        childKind: 'foreign',
                        childSummary:
                            'double usage scope: Expected ordered doubles to belong to the same double scope.',
                        summary: 'Expected double call order to match.'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage count and argument assertions reject non-doubles independently',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.callCount, function notADouble() {
                        return undefined;
                    }, 0);
                    testScope.assert(doubleUsage.notCalled, function notADouble() {
                        return undefined;
                    });
                    testScope.assert(doubleUsage.calledWith, function notADouble() {
                        return undefined;
                    }, []);
                    return testScope.assert.collect();
                });

                const summaries = failureSummaries(result);

                scope.require.notNull(summaries);
                scope.assert.deepEqual(summaries, [
                    'Expected double call count to match.',
                    'Expected double not to have calls.',
                    'Expected double call arguments to match.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'doubleUsage assertions reject non-doubles with assertion diagnostics',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.called, function notADouble() {
                        return undefined;
                    });
                    return testScope.assert.collect();
                });
                const composite = firstComposite(result);
                scope.require.notNull(composite);
                const child = firstChild(composite);
                scope.require.notNull(child);

                scope.assert.equal(composite.summary, 'Expected double to have at least one call.');
                scope.assert.equal(child.kind, 'foreign');
                scope.assert.equal(child.summary, 'test double: Expected an Overkill test double.');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
