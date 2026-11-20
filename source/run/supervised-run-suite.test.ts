import { suite } from '@overkill-dev/test';

import { testNode as supervisedRunCollectionTestNode } from './supervised-run-collection.test.ts';
import { testNode as supervisedRunStateTestNode } from './supervised-run-state.test.ts';
import { testNode as retryAttributionTestNode } from './retry-attribution.test.ts';
import { testNode as cancellationOptionsTestNode } from './run-cancellation.test.ts';

export const testNode = suite('source/run/supervised-run-suite.test.ts', [
    cancellationOptionsTestNode,
    retryAttributionTestNode,
    supervisedRunCollectionTestNode,
    supervisedRunStateTestNode
]);
