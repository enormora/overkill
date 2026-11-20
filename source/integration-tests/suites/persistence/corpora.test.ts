import { suite } from '@overkill-dev/test';

import { testNode as corpusSuiteTestNode } from '../../../run/corpus-suite.test.ts';
import { testNode as propertyCorpusExecutionTestNode } from '../../../run/property-corpus-execution.test.ts';
import { testNode as propertyCorpusStorageTestNode } from '../../../run/property-corpus-storage.test.ts';

export const testNode = suite('persistence corpora integration', [
    corpusSuiteTestNode,
    propertyCorpusExecutionTestNode,
    propertyCorpusStorageTestNode
]);
