import { suite } from '@overkill-dev/test';

import { testNode as progressReporterTestNode } from './progress-reporter.test.ts';
import { testNode as treeReporterTestNode } from './tree-reporter.test.ts';

export const testNode = suite('source/reporters/tree-progress-reporter-suite.test.ts', [
    progressReporterTestNode,
    treeReporterTestNode
]);
