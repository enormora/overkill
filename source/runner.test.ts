import { test } from 'uvu';
import * as assert from 'uvu/assert';
import sinon, { type SinonSpy } from 'sinon';
import { createRunner, type RunnerDependencies } from './runner.js';

function noop() {}

interface FakeTestRunSessionOverrides {
    readonly start?: SinonSpy;
    readonly runSingleTestCase?: SinonSpy;
    readonly done?: SinonSpy;
}

function createFakeTestRunSession(overrides: FakeTestRunSessionOverrides = {}): SinonSpy {
    const {
        start = sinon.fake.resolves(undefined),
        runSingleTestCase = sinon.fake.resolves(undefined),
        done = sinon.fake.resolves(undefined),
    } = overrides;

    return sinon.fake.returns({ start, runSingleTestCase, done });
}

interface Overrides {
    readonly createTestRunSession?: SinonSpy;
}

function runnerFactory(overrides: Overrides = {}) {
    const { createTestRunSession = createFakeTestRunSession() } = overrides;

    const fakeDependencies = {
        testRunSessionProvider: {
            createTestRunSession,
        },
    } as unknown as RunnerDependencies;

    return createRunner(fakeDependencies);
}

test('runs all tests that have been added so far', async () => {
    const runSingleTestCase = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ runSingleTestCase });
    const runner = runnerFactory({ createTestRunSession });

    runner.addTestCase({ title: 'foo', testFunction: noop });
    runner.addTestCase({ title: 'bar', testFunction: noop });
    await runner.runAll();

    assert.is(runSingleTestCase.callCount, 2);
    assert.equal(runSingleTestCase.firstCall.firstArg, { title: 'foo', index: 0, testFunction: noop });
    assert.equal(runSingleTestCase.secondCall.firstArg, { title: 'bar', index: 1, testFunction: noop });
});

test('when calling runAll() a second time it runs all tests that have been added before and after the first run', async () => {
    const runSingleTestCase = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ runSingleTestCase });
    const runner = runnerFactory({ createTestRunSession });

    runner.addTestCase({ title: 'foo', testFunction: noop });
    await runner.runAll();
    runner.addTestCase({ title: 'bar', testFunction: noop });
    await runner.runAll();

    assert.is(runSingleTestCase.callCount, 3);
});

test('when calling runAll() it creates a new test-run session with a new id', async () => {
    const runSingleTestCase = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ runSingleTestCase });
    const runner = runnerFactory({ createTestRunSession });

    runner.addTestCase({ title: 'foo', testFunction: noop });
    await Promise.all([runner.runAll(), runner.runAll()]);

    assert.is(createTestRunSession.callCount, 2);
    assert.equal(createTestRunSession.firstCall.args, [0, 1]);
    assert.equal(createTestRunSession.secondCall.args, [1, 1]);
    assert.is(runSingleTestCase.callCount, 2);
});

test('when calling runAll() a new test-run session is created with the exact amount of registred test cases', async () => {
    const createTestRunSession = createFakeTestRunSession();
    const runner = runnerFactory({ createTestRunSession });

    runner.addTestCase({ title: 'foo', testFunction: noop });
    runner.addTestCase({ title: 'bar', testFunction: noop });
    runner.addTestCase({ title: 'baz', testFunction: noop });
    await runner.runAll();

    assert.is(createTestRunSession.callCount, 1);
    assert.equal(createTestRunSession.firstCall.args, [0, 3]);
});

test('when calling runAll() the start method of the session is called', async () => {
    const start = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ start });
    const runner = runnerFactory({ createTestRunSession });

    await runner.runAll();

    assert.is(start.callCount, 1);
});

test('when calling runAll() the done method of the session is called with all test-case results', async () => {
    const runSingleTestCase = sinon
        .stub()
        .onFirstCall()
        .resolves('first-result')
        .onSecondCall()
        .resolves('second-result');
    const done = sinon.fake.resolves(undefined);
    const createTestRunSession = createFakeTestRunSession({ runSingleTestCase, done });
    const runner = runnerFactory({ createTestRunSession });

    runner.addTestCase({ title: 'foo', testFunction: noop });
    runner.addTestCase({ title: 'bar', testFunction: noop });
    await runner.runAll();

    assert.is(done.callCount, 1);
    assert.equal(done.firstCall.args, [['first-result', 'second-result']]);
});

test('runAll() returns the final result calculated by done()', async () => {
    const done = sinon.fake.resolves('the-final-result');
    const createTestRunSession = createFakeTestRunSession({ done });
    const runner = runnerFactory({ createTestRunSession });

    const finalResult = await runner.runAll();

    assert.equal(finalResult, 'the-final-result');
});

test.run();
