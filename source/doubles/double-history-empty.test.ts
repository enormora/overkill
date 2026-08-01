import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { testDouble } from './test-double.ts';

registerTest('empty history boundary accessors return null snapshots', function () {
    const loadValue = testDouble.returns('value');

    assert.equal(loadValue.firstCall, null);
    assert.equal(loadValue.firstConstruction, null);
    assert.equal(loadValue.firstInteraction, null);
    assert.equal(loadValue.firstResult, null);
    assert.equal(loadValue.lastCall, null);
    assert.equal(loadValue.lastConstruction, null);
    assert.equal(loadValue.lastInteraction, null);
    assert.equal(loadValue.lastResult, null);
});

registerTest('invalid history indexes return null snapshots', function () {
    const loadValue = testDouble.returns('value');

    assert.equal(loadValue.nthCall(-1), null);
    assert.equal(loadValue.nthCall(0.5), null);
    assert.equal(loadValue.nthConstruction(-1), null);
    assert.equal(loadValue.nthConstruction(0.5), null);
    assert.equal(loadValue.nthInteraction(-1), null);
    assert.equal(loadValue.nthInteraction(0.5), null);
});
