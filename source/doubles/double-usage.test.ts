import assert from 'node:assert/strict';
import type {
    FailedCheck,
    FailedCompositeCheck
} from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { registerTest } from '../test-support/register-test.ts';
import type { AssertionTestFailure, FailOutcome, RunResult } from '../engine/run-result.ts';
import type { TestBody, TestContext } from '../engine/test-node.ts';
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

function assertCountModeUsage(testContext: TestContext, loadUser: unknown, clientConstructor: unknown): void {
    testContext.assert(doubleUsage.called, loadUser);
    testContext.assert(doubleUsage.calledOnce, loadUser);
    testContext.assert(doubleUsage.callCount, loadUser, 1);
    testContext.assert(doubleUsage.constructed, clientConstructor);
    testContext.assert(doubleUsage.constructedOnce, clientConstructor);
    testContext.assert(doubleUsage.constructionCount, clientConstructor, 1);
    testContext.assert(doubleUsage.interacted, clientConstructor);
    testContext.assert(doubleUsage.interactedOnce, loadUser);
    testContext.assert(doubleUsage.interactionCount, loadUser, 1);
}

registerTest('doubleUsage count and mode assertions pass through case.assert()', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const Client = testDouble.constructs<ClientConstructor>({ id: 'client' });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });
        const client = new Client('https://api.example.test', { timeout: 500, token: 'primary' });

        testContext.assert.equal(client.id, 'client');
        assertCountModeUsage(testContext, loadUser, Client);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage negative mode assertions produce domain summaries', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });

        testContext.assert(doubleUsage.notInteracted, loadUser);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });
        ping();

        testContext.assert(doubleUsage.calledWith, loadUser, [ '42', { role: 'admin' } ]);
        testContext.assert(doubleUsage.calledWithPrefix, loadUser, [ '42' ]);
        testContext.assert(doubleUsage.calledWithExactly, loadUser, [
            '42',
            { role: 'admin', trace: 'trace-id' }
        ]);
        testContext.assert(doubleUsage.calledWith, ping, []);
        testContext.assert(doubleUsage.calledWithExactly, ping, []);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage iterator assertions pass through case.assert()', async function () {
    const loadEvents = testDouble.yields([ 'created', 'updated' ]);
    const result = await executeSingleBody(function body(testContext: TestContext) {
        const events = loadEvents();

        events.next();
        events.next();
        events.next();
        testContext.assert(doubleUsage.iterated, loadEvents);
        testContext.assert(doubleUsage.iteratorEventCount, loadEvents, 3);
        testContext.assert(doubleUsage.yieldCount, loadEvents, 2);
        testContext.assert(doubleUsage.yieldedExactly, loadEvents, [ 'created', 'updated' ]);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage iterator assertions report protocol history failures', async function () {
    const loadEvents = testDouble.yields([ 'created' ]);
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadEvents().next();

        testContext.assert(doubleUsage.notIterated, loadEvents);
        testContext.assert(doubleUsage.iteratorEventCount, loadEvents, 2);
        testContext.assert(doubleUsage.yieldCount, loadEvents, 2);
        testContext.assert(doubleUsage.yieldedExactly, loadEvents, [ 'updated' ]);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        ping();

        testContext.assert(doubleUsage.calledWithPrefix as unknown as typeof doubleUsage.calledWith, ping, []);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });

        testContext.assert(doubleUsage.calledWith, loadUser, [ '42' ]);
        return testContext.assert.done();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double call arguments to match.');
    assert.deepEqual(childSummaries(composite), [ 'call arguments' ]);
});

registerTest('doubleUsage once, last, and nth argument assertions use the relevant mode history', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('first', { role: 'reader', trace: 'one' });
        loadUser('second', { role: 'admin', trace: 'two' });

        testContext.assert(doubleUsage.nthCallWith, loadUser, 0, [ 'first', { role: 'reader' } ]);
        testContext.assert(doubleUsage.lastCalledWith, loadUser, [ 'second', { role: 'admin' } ]);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage argument assertion failures explain the matched position', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const ping = testDouble.returns<Ping>('pong');
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('42', { role: 'admin', trace: 'trace-id' });

        testContext.assert(doubleUsage.calledWithPrefix, loadUser, [ 'missing' ]);
        testContext.assert(doubleUsage.calledWithExactly, loadUser, [ '42', { role: 'reader', trace: 'trace-id' } ]);
        testContext.assert(doubleUsage.calledWithExactly, loadUser, [ '42' ]);
        testContext.assert(doubleUsage.lastCalledWith, ping, []);
        testContext.assert(doubleUsage.lastCalledWithExactly, loadUser, [
            '42',
            { role: 'reader', trace: 'trace-id' }
        ]);
        testContext.assert(doubleUsage.lastCalledWithPrefix, loadUser, [ 'missing' ]);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('first', { role: 'reader', trace: 'one' });
        loadUser('second', { role: 'admin', trace: 'two' });

        testContext.assert(doubleUsage.calledOnceWith, loadUser, [ 'first', { role: 'reader' } ]);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        const client = new Client('https://api.example.test', { timeout: 500, token: 'primary' });

        testContext.assert.equal(client.id, 'client');
        testContext.assert(doubleUsage.constructedOnceWith, Client, [
            'https://api.example.test',
            { token: 'primary' }
        ]);
        testContext.assert(doubleUsage.constructedWithPrefix, Client, [ 'https://api.example.test' ]);
        testContext.assert(doubleUsage.constructedWithExactly, Client, [
            'https://api.example.test',
            { timeout: 500, token: 'primary' }
        ]);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage indexed argument assertions validate index and event presence', async function () {
    const loadUser = testDouble.returns<LoadUser>({ id: '42', name: 'Ada' });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        loadUser('first', { role: 'reader', trace: 'one' });

        testContext.assert(doubleUsage.nthCallWith, loadUser, -1, [ 'first' ]);
        testContext.assert(doubleUsage.nthCallWith, loadUser, 3, [ 'first' ]);
        testContext.assert(doubleUsage.nthCallWithPrefix as unknown as typeof doubleUsage.nthCallWith, loadUser, 0, []);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        first();
        second();

        testContext.assert(doubleUsage.callOrder, [ first, second ]);
        testContext.assert(doubleUsage.interactionOrder, [ first, second ]);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage construction order compares constructor events', async function () {
    const { testDouble: scopedDouble } = createTestDoubleScope();
    const First = scopedDouble.constructs<ClientConstructor>({ id: 'first' });
    const Second = scopedDouble.constructs<ClientConstructor>({ id: 'second' });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        const first = new First('https://first.example.test', { timeout: 500, token: 'first' });
        const second = new Second('https://second.example.test', { timeout: 500, token: 'second' });

        testContext.assert.equal(first.id, 'first');
        testContext.assert.equal(second.id, 'second');
        testContext.assert(doubleUsage.constructionOrder, [ First, Second ]);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('doubleUsage order assertions require all previous events before the next double', async function () {
    const { testDouble: scopedDouble } = createTestDoubleScope();
    const first = scopedDouble.returns<Ping>('first');
    const second = scopedDouble.returns<Ping>('second');
    const result = await executeSingleBody(function body(testContext: TestContext) {
        first();
        second();
        first();

        testContext.assert(doubleUsage.callOrder, [ first, second ]);
        return testContext.assert.done();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double call order to match.');
    assert.deepEqual(childSummaries(composite), [ 'call order 0 before 1' ]);
});

registerTest('doubleUsage order assertions reject invalid and unused order inputs', async function () {
    const { testDouble: scopedDouble } = createTestDoubleScope();
    const first = scopedDouble.returns<Ping>('first');
    const second = scopedDouble.returns<Ping>('second');
    const result = await executeSingleBody(function body(testContext: TestContext) {
        first();

        testContext.assert(doubleUsage.callOrder as unknown as typeof doubleUsage.called, [ first ]);
        testContext.assert(doubleUsage.callOrder, [ first, second ]);
        testContext.assert(doubleUsage.callOrder, [ first, function notADouble() {
            return undefined;
        } ]);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        first();
        second();

        testContext.assert(doubleUsage.callOrder, [ first, second ]);
        return testContext.assert.done();
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
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.assert(doubleUsage.callCount, function notADouble() {
            return undefined;
        }, 0);
        testContext.assert(doubleUsage.notCalled, function notADouble() {
            return undefined;
        });
        testContext.assert(doubleUsage.calledWith, function notADouble() {
            return undefined;
        }, []);
        return testContext.assert.done();
    });

    assertFailureSummaries(result, [
        'Expected double call count to match.',
        'Expected double not to have calls.',
        'Expected double call arguments to match.'
    ]);
});

registerTest('doubleUsage assertions reject non-doubles with assertion diagnostics', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.assert(doubleUsage.called, function notADouble() {
            return undefined;
        });
        return testContext.assert.done();
    });
    const composite = firstComposite(result);

    assert.equal(composite.summary, 'Expected double to have at least one call.');
    assert.equal(firstChild(composite).kind, 'foreign');
    assert.equal(firstChild(composite).summary, 'test double: Expected an Overkill test double.');
});
