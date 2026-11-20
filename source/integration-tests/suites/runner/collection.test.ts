import { suite } from '@overkill-dev/test';

import { testNode as directEntrypointCollectionTestNode } from '../../../run/direct-entrypoint-collection.test.ts';
import { testNode as initializedRunTestNode } from '../../../run/initialized-run.test.ts';

export const testNode = suite('runner collection integration', [
    directEntrypointCollectionTestNode,
    initializedRunTestNode
]);
