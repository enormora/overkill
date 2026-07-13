import assert from 'node:assert/strict';
import { asyncNoop, noop } from 'noop-esm';
import sinon, { type SinonStub } from 'sinon';
import { registerTest } from '../test-support/register-test.ts';
import {
    createTestCaseExecutor,
    type TestCaseExecutor,
    type TestCaseExecutorDependencies
} from './test-case-executor.ts';

function errorTestFunction(): never {
    throw new Error('failed with error');
}

type Overrides = {
    readonly now?: SinonStub;
};

function executorFactory(overrides: Overrides = {}): TestCaseExecutor {
    const { now = sinon.fake.returns(0) } = overrides;

    const fakeDependencies = {
        timingApi: {
            now
        }
    } as unknown as TestCaseExecutorDependencies;

    return createTestCaseExecutor(fakeDependencies);
}

registerTest('returns "success" when the given test function doesn’t throw', async function () {
    const executor = executorFactory();
    const result = await executor.execute(noop);

    assert.deepStrictEqual(result, { status: 'success', duration: 0 });
});

registerTest('returns "success" when the given async test function doesn’t reject', async function () {
    const executor = executorFactory();
    const result = await executor.execute(asyncNoop);

    assert.deepStrictEqual(result, { status: 'success', duration: 0 });
});

registerTest('returns "failure" when the given test function throws an error', async function () {
    const executor = executorFactory();
    const result = await executor.execute(errorTestFunction);

    assert.deepStrictEqual(result, { status: 'failure', reason: 'failed with error', duration: 0 });
});

registerTest('returns "failure" when the given test function throws a non error', async function () {
    const executor = executorFactory();
    const nonErrorFailureTestFunction = async function (): Promise<void> {
        const result = Promise.withResolvers<undefined>();
        result.reject({ reason: 'not-an-error' });

        await result.promise;
    };
    const result = await executor.execute(nonErrorFailureTestFunction);

    assert.deepStrictEqual(result, { status: 'failure', reason: 'Unknown error', duration: 0 });
});

registerTest('returns "failure" when the given async test function rejects an error', async function () {
    const executor = executorFactory();
    const result = await executor.execute(async function () {
        throw new Error('async error');
    });

    assert.deepStrictEqual(result, { status: 'failure', reason: 'async error', duration: 0 });
});

registerTest('returns the correct duration when a test was successful', async function () {
    const now = sinon.stub().onFirstCall().returns(10).onSecondCall().returns(30);
    const executor = executorFactory({ now });
    const result = await executor.execute(noop);

    assert.deepStrictEqual(result, { status: 'success', duration: 20 });
});

registerTest('returns the correct duration when a test failed', async function () {
    const now = sinon.stub().onFirstCall().returns(10).onSecondCall().returns(30);
    const executor = executorFactory({ now });
    const result = await executor.execute(errorTestFunction);

    assert.deepStrictEqual(result, { status: 'failure', reason: 'failed with error', duration: 20 });
});
