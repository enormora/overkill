import { test } from 'uvu';
import * as assert from 'uvu/assert';
import sinon, { SinonSpy } from 'sinon';
import { createRunner, RunnerDependencies } from '../../src/runner';

function noop() {}

interface Overrides {
  execute?: SinonSpy;
}

function runnerFactory(overrides: Overrides = {}) {
  const { execute = sinon.fake.returns({}) } = overrides;

  const fakeDependencies = ({
    testCaseExecutor: {
      execute,
    },
  } as unknown) as RunnerDependencies;

  return createRunner(fakeDependencies);
}

test('executes all tests that have been added so far', () => {
  const execute = sinon.fake();
  const runner = runnerFactory({ execute });

  runner.addTestCase({ title: 'foo', testFn: noop });
  runner.addTestCase({ title: 'bar', testFn: noop });
  runner.runAll();

  assert.is(execute.callCount, 2);
  assert.equal(execute.firstCall.args, [noop]);
  assert.equal(execute.secondCall.args, [noop]);
});

test('when calling runAll() a second time it executes all tests that have been added before and after the first run', () => {
  const execute = sinon.fake();
  const runner = runnerFactory({ execute });

  runner.addTestCase({ title: 'foo', testFn: noop });
  runner.runAll();
  runner.addTestCase({ title: 'bar', testFn: noop });
  runner.runAll();

  assert.is(execute.callCount, 3);
});

test('returns the aggregated result of all test cases', () => {
  const execute = sinon
    .stub()
    .onFirstCall()
    .returns({ status: 'success', duration: 21 })
    .onSecondCall()
    .returns({ status: 'success', duration: 42 });
  const runner = runnerFactory({ execute });

  runner.addTestCase({ title: 'foo', testFn: noop });
  runner.addTestCase({ title: 'bar', testFn: noop });
  const result = runner.runAll();

  assert.equal(result, {
    progress: 'completed',
    totalCount: 2,
    testCaseResults: [
      {
        testCaseDetails: { title: 'foo' },
        result: { status: 'success', duration: 21 },
      },
      {
        testCaseDetails: { title: 'bar' },
        result: { status: 'success', duration: 42 },
      },
    ],
  });
});

test.run();
