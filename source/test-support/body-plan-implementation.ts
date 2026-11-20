import type { TestScope } from '@overkill-dev/test';
import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';

export const body = {
    version: '1',
    implementation(scope: TestScope, input: unknown): AssertionResult {
        scope.assert.equal(input, null);
        return scope.assert.collect();
    }
};
