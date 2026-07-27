import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { assertionSources } from './assertion-node-shape.ts';

registerTest('assertionSources declares the built-in assertion origins', function () {
    assert.deepStrictEqual(assertionSources, [ 'assert', 'require' ]);
});
