import { test } from 'uvu';
import * as assert from 'uvu/assert';
import sinon, { type SinonStub } from 'sinon';
import { createTestCaseExecutor, type TestCaseExecutorDependencies } from './test-case-executor.js';

function successTestFunction() {}

function errorTestFunction() {
    throw new Error('failed with error');
}

function nonErrorFailureTestFunction() {
    throw 'not-an-error';
}

interface Overrides {
    readonly now?: SinonStub;
}

function executorFactory(overrides: Overrides = {}) {
    const { now = sinon.fake.returns(0) } = overrides;

    const fakeDependencies = {
        timingApi: {
            now,
        },
    } as unknown as TestCaseExecutorDependencies;

    return createTestCaseExecutor(fakeDependencies);
}

test('returns "success" when the given test function doesn’t throw', async () => {
    const executor = executorFactory();
    const result = await executor.execute(successTestFunction);

    assert.equal(result, { status: 'success', duration: 0 });
});

test('returns "success" when the given async test function doesn’t reject', async () => {
    const executor = executorFactory();
    const result = await executor.execute(async () => {});

    assert.equal(result, { status: 'success', duration: 0 });
});

test('returns "failure" when the given test function throws an error', async () => {
    const executor = executorFactory();
    const result = await executor.execute(errorTestFunction);

    assert.equal(result, { status: 'failure', reason: 'failed with error', duration: 0 });
});

test('returns "failure" when the given test function throws a non error', async () => {
    const executor = executorFactory();
    const result = await executor.execute(nonErrorFailureTestFunction);

    assert.equal(result, { status: 'failure', reason: 'Unknown error', duration: 0 });
});

test('returns "failure" when the given async test function rejects an error', async () => {
    const executor = executorFactory();
    const result = await executor.execute(async () => {
        throw new Error('async error');
    });

    assert.equal(result, { status: 'failure', reason: 'async error', duration: 0 });
});

test('returns the correct duration when a test was successful', async () => {
    const now = sinon.stub().onFirstCall().returns(10).onSecondCall().returns(30);
    const executor = executorFactory({ now });
    const result = await executor.execute(successTestFunction);

    assert.equal(result, { status: 'success', duration: 20 });
});

test('returns the correct duration when a test failed', async () => {
    const now = sinon.stub().onFirstCall().returns(10).onSecondCall().returns(30);
    const executor = executorFactory({ now });
    const result = await executor.execute(errorTestFunction);

    assert.equal(result, { status: 'failure', reason: 'failed with error', duration: 20 });
});

test.run();
