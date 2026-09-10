import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as doubleHistoryEmptyTestNode } from '../../doubles/double-history-empty.test.ts';
import { testNode as testDoubleCallbackTestNode } from '../../doubles/test-double-callback.test.ts';
import { testNode as testDoubleConfigurationTestNode } from '../../doubles/test-double-configuration.test.ts';
import { testNode as testDoubleConstructionTestNode } from '../../doubles/test-double-construction.test.ts';
import { testNode as testDoubleGeneratorTestNode } from '../../doubles/test-double-generator.test.ts';
import { testNode as testDoubleHistoryTestNode } from '../../doubles/test-double-history.test.ts';
import { testNode as testDoubleHistoryRuntimeTestNode } from '../../doubles/test-double-history-runtime.test.ts';
import { testNode as testDoubleTestNode } from '../../doubles/test-double.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/test-double-runtime.ts',
    annotations: {},
    controls: {},
    children: [
        doubleHistoryEmptyTestNode,
        testDoubleCallbackTestNode,
        testDoubleConfigurationTestNode,
        testDoubleConstructionTestNode,
        testDoubleGeneratorTestNode,
        testDoubleHistoryRuntimeTestNode,
        testDoubleHistoryTestNode,
        testDoubleTestNode
    ]
});
