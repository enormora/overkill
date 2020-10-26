import { test } from 'uvu';
import * as assert from 'uvu/assert';
import sinon, { SinonStub } from 'sinon';
import { createRunner, RunnerDependencies } from '../../src/runner';

function successTestFn() {}

function errorTestFn() {
  throw new Error('failed with error');
}

function nonErrorFailureTestFn() {
  throw 'not-an-error';
}

interface Overrides {
  now?: SinonStub;
}

function runnerFactory(overrides: Overrides = {}) {
  const { now = sinon.fake.returns(0) } = overrides;

  const fakeDependencies = ({
    timingApi: {
      now,
    },
  } as unknown) as RunnerDependencies;

  return createRunner(fakeDependencies);
}

test('returns "success" when the given test function doesn’t throw', () => {
  const runner = runnerFactory();
  const result = runner.runTest(successTestFn);

  assert.equal(result, { status: 'success', duration: 0 });
});

test('returns "failure" when the given test function throws an error', () => {
  const runner = runnerFactory();
  const result = runner.runTest(errorTestFn);

  assert.equal(result, { status: 'failure', reason: 'failed with error', duration: 0 });
});

test('returns "failure" when the given test function throws a non error', () => {
  const runner = runnerFactory();
  const result = runner.runTest(nonErrorFailureTestFn);

  assert.equal(result, { status: 'failure', reason: 'Unknown error', duration: 0 });
});

test('returns the correct duration when a test was successful', () => {
  const now = sinon.stub().onFirstCall().returns(10).onSecondCall().returns(30);
  const runner = runnerFactory({ now });
  const result = runner.runTest(successTestFn);

  assert.equal(result, { status: 'success', duration: 20 });
});

test('returns the correct duration when a test failed', () => {
  const now = sinon.stub().onFirstCall().returns(10).onSecondCall().returns(30);
  const runner = runnerFactory({ now });
  const result = runner.runTest(errorTestFn);

  assert.equal(result, { status: 'failure', reason: 'failed with error', duration: 20 });
});

test.run();
