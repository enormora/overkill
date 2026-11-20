import { suite } from '@overkill-dev/test';

import { testNode as compatibilityEntryPointTestNode } from './compatibility-entry-point.test.ts';
import { testNode as skippedTestEntryPointTestNode } from './skipped-test-entry-point.test.ts';

export const testNode = suite('source/packages/test compatibility authoring', [
    compatibilityEntryPointTestNode,
    skippedTestEntryPointTestNode
]);
