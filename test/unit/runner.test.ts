import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { runTest } from '../../src/runner';

function successTestFn() {}

function errorTestFn() {
  throw new Error('failed with error');
}

function nonErrorFailureTestFn() {
  throw 'not-an-error';
}

test('returns "success" when the given test function doesn’t throw', () => {
  const result = runTest(successTestFn);

  assert.equal(result, { status: 'success' });
});

test('returns "failure" when the given test function throws an error', () => {
  const result = runTest(errorTestFn);

  assert.equal(result, { status: 'failure', reason: 'failed with error' });
});

test('returns "failure" when the given test function throws a non error', () => {
  const result = runTest(nonErrorFailureTestFn);

  assert.equal(result, { status: 'failure', reason: 'Unknown error' });
});

test.run();
