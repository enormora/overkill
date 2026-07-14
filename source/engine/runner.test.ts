import assert from 'node:assert/strict';
import { noop } from 'noop-esm';
import sinon, { type SinonSpy } from 'sinon';
import { registerTest } from '../test-support/register-test.ts';
import { createRunner, type Runner, type RunnerDependencies } from './runner.ts';
import { createSuite } from './suite.ts';

type FakeTestRunSessionOverrides = {
    readonly start?: SinonSpy;
    readonly runSingleTestCase?: SinonSpy;
    readonly done?: SinonSpy;
};

function createFakeTestRunSession(overrides: FakeTestRunSessionOverrides = {}): SinonSpy {
    const {
        start = sinon.fake.resolves(undefined),
        runSingleTestCase = sinon.fake.resolves(undefined),
        done = sinon.fake.resolves(undefined)
    } = overrides;

    return sinon.fake.returns({ start, runSingleTestCase, done });
}

type Overrides = {
    readonly createTestRunSession?: SinonSpy;
};

function runnerFactory(overrides: Overrides = {}): Runner {
    const { createTestRunSession = createFakeTestRunSession() } = overrides;

    const fakeDependencies = {
        testRunSessionProvider: {
            createTestRunSession
        }
    } as unknown as RunnerDependencies;

    return createRunner(fakeDependencies);
}

registerTest('runs all tests that have been added so far', async function () {
    const runSingleTestCase = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ runSingleTestCase });
    const runner = runnerFactory({ createTestRunSession });

    runner.addSuite(
        createSuite('the-suite', [
            { title: 'foo', testFunction: noop },
            { title: 'bar', testFunction: noop }
        ])
    );
    await runner.runAll();

    assert.strictEqual(runSingleTestCase.callCount, 2);
    assert.deepStrictEqual(runSingleTestCase.firstCall.firstArg, {
        title: 'foo',
        testFunction: noop,
        suiteTitle: 'the-suite'
    });
    assert.deepStrictEqual(runSingleTestCase.secondCall.firstArg, {
        title: 'bar',
        testFunction: noop,
        suiteTitle: 'the-suite'
    });
});

registerTest(
    'when calling runAll() a second time it runs all tests that have been added before and after the first run',
    async function () {
        const runSingleTestCase = sinon.fake.resolves(undefined);
        const createTestRunSession = createFakeTestRunSession({ runSingleTestCase });
        const runner = runnerFactory({ createTestRunSession });

        runner.addSuite(createSuite('suite-1', [ { title: 'foo', testFunction: noop } ]));
        await runner.runAll();
        runner.addSuite(createSuite('suite-2', [ { title: 'bar', testFunction: noop } ]));
        await runner.runAll();

        assert.strictEqual(runSingleTestCase.callCount, 3);
    }
);

registerTest('when calling runAll() it creates a new test-run session with a new id', async function () {
    const runSingleTestCase = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ runSingleTestCase });
    const runner = runnerFactory({ createTestRunSession });

    runner.addSuite(createSuite('the-suite', [ { title: 'foo', testFunction: noop } ]));
    await Promise.all([ runner.runAll(), runner.runAll() ]);

    assert.strictEqual(createTestRunSession.callCount, 2);
    assert.deepStrictEqual(createTestRunSession.firstCall.args, [ 0, 1 ]);
    assert.deepStrictEqual(createTestRunSession.secondCall.args, [ 1, 1 ]);
    assert.strictEqual(runSingleTestCase.callCount, 2);
});

registerTest(
    'when calling runAll() a new test-run session is created with the exact amount of registered test cases',
    async function () {
        const createTestRunSession = createFakeTestRunSession();
        const runner = runnerFactory({ createTestRunSession });

        runner.addSuite(
            createSuite('the-suite', [
                { title: 'foo', testFunction: noop },
                { title: 'bar', testFunction: noop },
                { title: 'baz', testFunction: noop }
            ])
        );
        await runner.runAll();

        assert.strictEqual(createTestRunSession.callCount, 1);
        assert.deepStrictEqual(createTestRunSession.firstCall.args, [ 0, 3 ]);
    }
);

registerTest('when calling runAll() the start method of the session is called', async function () {
    const start = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ start });
    const runner = runnerFactory({ createTestRunSession });

    await runner.runAll();

    assert.strictEqual(start.callCount, 1);
});

registerTest(
    'when calling runAll() the done method of the session is called with all test-case results',
    async function () {
        const runSingleTestCase = sinon
            .stub()
            .onFirstCall()
            .resolves('first-result')
            .onSecondCall()
            .resolves('second-result');
        const done = sinon.fake.resolves(undefined);
        const createTestRunSession = createFakeTestRunSession({ runSingleTestCase, done });
        const runner = runnerFactory({ createTestRunSession });

        runner.addSuite(
            createSuite('the-suite', [
                { title: 'foo', testFunction: noop },
                { title: 'bar', testFunction: noop }
            ])
        );
        await runner.runAll();

        assert.strictEqual(done.callCount, 1);
        assert.deepStrictEqual(done.firstCall.args, [ [ 'first-result', 'second-result' ] ]);
    }
);

registerTest('runAll() returns the final result calculated by done()', async function () {
    const done = sinon.fake.resolves('the-final-result');
    const createTestRunSession = createFakeTestRunSession({ done });
    const runner = runnerFactory({ createTestRunSession });

    const finalResult = await runner.runAll();

    assert.deepStrictEqual(finalResult, 'the-final-result');
});
