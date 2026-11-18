import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as corpusSuiteTestNode } from '../../../run/corpus-suite.test.ts';
import { testNode as propertyCorpusExecutionTestNode } from '../../../run/property-corpus-execution.test.ts';
import { testNode as propertyCorpusStorageTestNode } from '../../../run/property-corpus-storage.test.ts';

export const testNode = createSuite({
    title: 'persistence corpora integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ corpusSuiteTestNode, propertyCorpusExecutionTestNode, propertyCorpusStorageTestNode ]
});
