import { test } from 'uvu';
import * as assert from 'uvu/assert';
import sinon, { SinonSpy } from 'sinon';
import { createRunner, RunnerDependencies } from '../../src/runner';

function noop() {}

interface Overrides {
  readonly execute?: SinonSpy;
  readonly update?: SinonSpy;
}

function runnerFactory(overrides: Overrides = {}) {
  const { execute = sinon.fake.returns({}), update = sinon.fake.resolves(undefined) } = overrides;

  const fakeDependencies = ({
    testCaseExecutor: {
      execute,
    },
    reporter: {
      update,
    },
  } as unknown) as RunnerDependencies;

  return createRunner(fakeDependencies);
}

test('executes all tests that have been added so far', async () => {
  const execute = sinon.fake.returns({});
  const runner = runnerFactory({ execute });

  runner.addTestCase({ title: 'foo', testFn: noop });
  runner.addTestCase({ title: 'bar', testFn: noop });
  await runner.runAll();

  assert.is(execute.callCount, 2);
  assert.equal(execute.firstCall.args, [noop]);
  assert.equal(execute.secondCall.args, [noop]);
});

test('when calling runAll() a second time it executes all tests that have been added before and after the first run', async () => {
  const execute = sinon.fake.returns({});
  const runner = runnerFactory({ execute });

  runner.addTestCase({ title: 'foo', testFn: noop });
  await runner.runAll();
  runner.addTestCase({ title: 'bar', testFn: noop });
  await runner.runAll();

  assert.is(execute.callCount, 3);
});

test('returns the aggregated result of all test cases', async () => {
  const execute = sinon
    .stub()
    .onFirstCall()
    .returns({ status: 'success', duration: 21 })
    .onSecondCall()
    .returns({ status: 'success', duration: 42 });
  const runner = runnerFactory({ execute });

  runner.addTestCase({ title: 'foo', testFn: noop });
  runner.addTestCase({ title: 'bar', testFn: noop });
  const result = await runner.runAll();

  assert.equal(result, {
    progress: 'completed',
    summary: {
      totalCount: 2,
      failedCount: 0,
      successCount: 2,
      completedCount: 2,
      pendingCount: 0,
    },
    testCaseResults: [
      {
        testCaseDetails: { title: 'foo', index: 0 },
        result: { status: 'success', duration: 21 },
      },
      {
        testCaseDetails: { title: 'bar', index: 1 },
        result: { status: 'success', duration: 42 },
      },
    ],
  });
});

test('calculates the correct amount of failed tests', async () => {
  const execute = sinon
    .stub()
    .onFirstCall()
    .returns({ status: 'success', duration: 21 })
    .onSecondCall()
    .returns({ status: 'failure', duration: 42 });
  const runner = runnerFactory({ execute });

  runner.addTestCase({ title: 'foo', testFn: noop });
  runner.addTestCase({ title: 'bar', testFn: noop });
  const result = await runner.runAll();

  assert.equal(result.summary, {
    totalCount: 2,
    failedCount: 1,
    successCount: 1,
    completedCount: 2,
    pendingCount: 0,
  });
});

test('updates the given reporter with the current result', async () => {
  const execute = sinon
    .stub()
    .onFirstCall()
    .returns({ status: 'success', duration: 21 })
    .onSecondCall()
    .returns({ status: 'failure', duration: 42 });
  const update = sinon.fake.resolves(undefined);
  const runner = runnerFactory({ execute, update });

  runner.addTestCase({ title: 'foo', testFn: noop });
  runner.addTestCase({ title: 'bar', testFn: noop });
  await runner.runAll();

  assert.is(update.callCount, 2);
  assert.equal(update.firstCall.args, [
    {
      progress: 'pending',
      summary: { failedCount: 0, successCount: 1, totalCount: 2, completedCount: 1, pendingCount: 1 },
      testCaseResults: [
        {
          testCaseDetails: { title: 'foo', index: 0 },
          result: { status: 'success', duration: 21 },
        },
      ],
    },
  ]);
  assert.equal(update.secondCall.args, [
    {
      progress: 'pending',
      summary: { failedCount: 1, successCount: 1, totalCount: 2, completedCount: 2, pendingCount: 0 },
      testCaseResults: [
        {
          testCaseDetails: { title: 'foo', index: 0 },
          result: { status: 'success', duration: 21 },
        },
        {
          testCaseDetails: { title: 'bar', index: 1 },
          result: { status: 'failure', duration: 42 },
        },
      ],
    },
  ]);
});

test.run();
