import assert from 'node:assert/strict';
import type {
    FailedCheck,
    FailedCompositeCheck
} from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { registerTest } from '../test-support/register-test.ts';
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
            engine.createSuite({
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

function firstFailOutcome(result: RunResult): FailOutcome {
    const firstResult = result.perTest.at(0);

    assert.notEqual(firstResult, undefined);

    if (firstResult?.outcome.kind === 'fail') {
        return firstResult.outcome;
    }

    throw new TypeError('Expected first outcome to fail.');
}

function firstAssertionFailure(result: RunResult): AssertionTestFailure {
    const failure = firstFailOutcome(result).failures[0];

    if (failure.kind === 'assertion') {
        return failure;
    }

    throw new TypeError('Expected assertion failure.');
}

function firstComposite(result: RunResult): FailedCompositeCheck {
    const check = firstAssertionFailure(result).checks[0];

    if (check.kind === 'composite') {
        return check;
    }

    throw new TypeError('Expected composite check.');
}

function childSummaries(check: FailedCompositeCheck): readonly string[] {
    return check.children.map(function summary(child) {
        return child.summary;
    });
}

function firstChild(check: FailedCompositeCheck): FailedCheck {
    return check.children[0];
}

function assertFailureSummaries(result: RunResult, expectedSummaries: readonly string[]): void {
    assert.deepEqual(
        firstAssertionFailure(result).checks.map(function summary(check) {
            return check.summary;
        }),
        expectedSummaries
    );
}

function assertCountModeUsage(testScope: TestScope, loadUser: unknown, clientConstructor: unknown): void {
    testScope.assert(doubleUsage.called, loadUser);
    testScope.assert(doubleUsage.calledOnce, loadUser);
    testScope.assert(doubleUsage.callCount, loadUser, 1);
    testScope.assert(doubleUsage.constructed, clientConstructor);
    testScope.assert(doubleUsage.constructedOnce, clientConstructor);
    testScope.assert(doubleUsage.constructionCount, clientConstructor, 1);
    testScope.assert(doubleUsage.interacted, clientConstructor);
    testScope.assert(doubleUsage.interactedOnce, loadUser);
    testScope.assert(doubleUsage.interactionCount, loadUser, 1);
}

registerTest('doubleUsage count and mode assertions pass through scope.assert()', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const Client = testDouble.constructs<ClientConstructor>({ id: 'client' });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });
        const client = new Client('https://api.example.test', { timeout: 500, token: 'primary' });

        testScope.assert.equal(client.id, 'client');
        assertCountModeUsage(testScope, loadUser, Client);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage negative mode assertions produce domain summaries', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });

        testScope.assert(doubleUsage.notInteracted, loadUser);
        return testScope.assert.collect();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double not to have interactions.');
    assert.deepEqual(childSummaries(composite), [ 'interaction count' ]);
    assert.deepEqual(firstChild(composite).actual, serializeValue(1));
    assert.deepEqual(firstChild(composite).expected, serializeValue(0));
});

registerTest('doubleUsage argument assertions support partial, prefix, and exact matching', async function () {
    const user = { id: '42', name: 'Ada' };
    const loadUser = testDouble.returns<LoadUser>(user);
    const ping = testDouble.returns<Ping>('pong');
    const result = await executeSingleBody(function body(testScope: TestScope) {
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

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage iterator assertions pass through scope.assert()', async function () {
    const loadEvents = testDouble.yields([ 'created', 'updated' ]);
    const result = await executeSingleBody(function body(testScope: TestScope) {
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

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage iterator assertions report protocol history failures', async function () {
    const loadEvents = testDouble.yields([ 'created' ]);
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadEvents().next();

        testScope.assert(doubleUsage.notIterated, loadEvents);
        testScope.assert(doubleUsage.iteratorEventCount, loadEvents, 2);
        testScope.assert(doubleUsage.yieldCount, loadEvents, 2);
        testScope.assert(doubleUsage.yieldedExactly, loadEvents, [ 'updated' ]);
        return testScope.assert.collect();
    });

    assertFailureSummaries(result, [
        'Expected double iterator not to have been consumed.',
        'Expected double iterator event count to match.',
        'Expected double yield count to match.',
        'Expected double yielded values to match exactly.'
    ]);
});

registerTest('doubleUsage prefix assertions reject empty prefixes', async function () {
    const ping = testDouble.returns<Ping>('pong');
    const result = await executeSingleBody(function body(testScope: TestScope) {
        ping();

        testScope.assert(doubleUsage.calledWithPrefix as unknown as typeof doubleUsage.calledWith, ping, []);
        return testScope.assert.collect();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double call arguments to match.');
    assert.equal(firstChild(composite).kind, 'foreign');
    assert.equal(
        firstChild(composite).summary,
        'expected argument prefix: Expected argument prefix to contain at least one item.'
    );
});

registerTest('doubleUsage argument assertions distinguish exact arity from prefix arity', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });

        testScope.assert(doubleUsage.calledWith, loadUser, [ '42' ]);
        return testScope.assert.collect();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double call arguments to match.');
    assert.deepEqual(childSummaries(composite), [ 'call arguments' ]);
});

registerTest('doubleUsage once, last, and nth argument assertions use the relevant mode history', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadUser('first', { role: 'reader', trace: 'one' });
        loadUser('second', { role: 'admin', trace: 'two' });

        testScope.assert(doubleUsage.nthCallWith, loadUser, 0, [ 'first', { role: 'reader' } ]);
        testScope.assert(doubleUsage.lastCalledWith, loadUser, [ 'second', { role: 'admin' } ]);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage argument assertion failures explain the matched position', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const ping = testDouble.returns<Ping>('pong');
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });

        testScope.assert(doubleUsage.calledWithPrefix, loadUser, [ 'missing' ]);
        testScope.assert(doubleUsage.calledWithExactly, loadUser, [ '42', { role: 'reader', trace: 'trace-id' } ]);
        testScope.assert(doubleUsage.calledWithExactly, loadUser, [ '42' ]);
        testScope.assert(doubleUsage.lastCalledWith, ping, []);
        testScope.assert(doubleUsage.lastCalledWithExactly, loadUser, [
            '42',
            { role: 'reader', trace: 'trace-id' }
        ]);
        testScope.assert(doubleUsage.lastCalledWithPrefix, loadUser, [ 'missing' ]);
        return testScope.assert.collect();
    });

    assertFailureSummaries(result, [
        'Expected double call arguments to match.',
        'Expected double call arguments to match.',
        'Expected double call arguments to match.',
        'Expected double call arguments to match.',
        'Expected double call arguments to match.',
        'Expected double call arguments to match.'
    ]);
});

registerTest('doubleUsage calledOnceWith requires one total call in that mode', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadUser('first', { role: 'reader', trace: 'one' });
        loadUser('second', { role: 'admin', trace: 'two' });

        testScope.assert(doubleUsage.calledOnceWith, loadUser, [ 'first', { role: 'reader' } ]);
        return testScope.assert.collect();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double call arguments to match.');
    assert.deepEqual(firstChild(composite).actual, serializeValue(2));
    assert.deepEqual(firstChild(composite).expected, serializeValue(1));
});

registerTest('doubleUsage construction argument assertions use construction history', async function () {
    const Client = testDouble<ClientConstructor>({
        fallback: rule.constructs({ id: 'client' })
    });
    const result = await executeSingleBody(function body(testScope: TestScope) {
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

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage indexed argument assertions validate index and event presence', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        loadUser('first', { role: 'reader', trace: 'one' });

        testScope.assert(doubleUsage.nthCallWith, loadUser, -1, [ 'first' ]);
        testScope.assert(doubleUsage.nthCallWith, loadUser, 3, [ 'first' ]);
        testScope.assert(doubleUsage.nthCallWithPrefix as unknown as typeof doubleUsage.nthCallWith, loadUser, 0, []);
        return testScope.assert.collect();
    });

    assertFailureSummaries(result, [
        'Expected indexed double call arguments to match.',
        'Expected indexed double call arguments to match.',
        'Expected indexed double call arguments to match.'
    ]);
});

registerTest('doubleUsage order assertions compare events across doubles from one scope', async function () {
    const { testDouble: scopedDouble } = createTestDoubleScope();
    const first = scopedDouble.returns<Ping>('first');
    const second = scopedDouble.returns<Ping>('second');
    const result = await executeSingleBody(function body(testScope: TestScope) {
        first();
        second();

        testScope.assert(doubleUsage.callOrder, [ first, second ]);
        testScope.assert(doubleUsage.interactionOrder, [ first, second ]);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage construction order compares constructor events', async function () {
    const { testDouble: scopedDouble } = createTestDoubleScope();
    const First = scopedDouble.constructs<ClientConstructor>({ id: 'first' });
    const Second = scopedDouble.constructs<ClientConstructor>({ id: 'second' });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        const first = new First('https://first.example.test', { timeout: 500, token: 'first' });
        const second = new Second('https://second.example.test', { timeout: 500, token: 'second' });

        testScope.assert.equal(first.id, 'first');
        testScope.assert.equal(second.id, 'second');
        testScope.assert(doubleUsage.constructionOrder, [ First, Second ]);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage order assertions require all previous events before the next double', async function () {
    const { testDouble: scopedDouble } = createTestDoubleScope();
    const first = scopedDouble.returns<Ping>('first');
    const second = scopedDouble.returns<Ping>('second');
    const result = await executeSingleBody(function body(testScope: TestScope) {
        first();
        second();
        first();

        testScope.assert(doubleUsage.callOrder, [ first, second ]);
        return testScope.assert.collect();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double call order to match.');
    assert.deepEqual(childSummaries(composite), [ 'call order 0 before 1' ]);
});

registerTest('doubleUsage order assertions reject invalid and unused order inputs', async function () {
    const { testDouble: scopedDouble } = createTestDoubleScope();
    const first = scopedDouble.returns<Ping>('first');
    const second = scopedDouble.returns<Ping>('second');
    const result = await executeSingleBody(function body(testScope: TestScope) {
        first();

        testScope.assert(doubleUsage.callOrder as unknown as typeof doubleUsage.called, [ first ]);
        testScope.assert(doubleUsage.callOrder, [ first, second ]);
        testScope.assert(doubleUsage.callOrder, [ first, function notADouble() {
            return undefined;
        } ]);
        return testScope.assert.collect();
    });

    assertFailureSummaries(result, [
        'Expected double call order to match.',
        'Expected double call order to match.',
        'Expected double call order to match.'
    ]);
});

registerTest('doubleUsage order assertions reject mixed double scopes', async function () {
    const firstScope = createTestDoubleScope();
    const secondScope = createTestDoubleScope();
    const first = firstScope.testDouble.returns<Ping>('first');
    const second = secondScope.testDouble.returns<Ping>('second');
    const result = await executeSingleBody(function body(testScope: TestScope) {
        first();
        second();

        testScope.assert(doubleUsage.callOrder, [ first, second ]);
        return testScope.assert.collect();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double call order to match.');
    assert.equal(firstChild(composite).kind, 'foreign');
    assert.equal(
        firstChild(composite).summary,
        'double usage scope: Expected ordered doubles to belong to the same double scope.'
    );
});

registerTest('doubleUsage count and argument assertions reject non-doubles independently', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
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

    assertFailureSummaries(result, [
        'Expected double call count to match.',
        'Expected double not to have calls.',
        'Expected double call arguments to match.'
    ]);
});

registerTest('doubleUsage assertions reject non-doubles with assertion diagnostics', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.called, function notADouble() {
            return undefined;
        });
        return testScope.assert.collect();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double to have at least one call.');
    assert.equal(firstChild(composite).kind, 'foreign');
    assert.equal(firstChild(composite).summary, 'test double: Expected an Overkill test double.');
});
