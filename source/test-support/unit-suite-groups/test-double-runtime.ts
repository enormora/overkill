import { createSuite } from '@overkill-dev/engine';
import { testSuite as doubleHistoryEmptyTestSuite } from '../../doubles/double-history-empty.test.ts';
import { testSuite as testDoubleCallbackTestSuite } from '../../doubles/test-double-callback.test.ts';
import { testSuite as testDoubleConfigurationTestSuite } from '../../doubles/test-double-configuration.test.ts';
import { testSuite as testDoubleConstructionTestSuite } from '../../doubles/test-double-construction.test.ts';
import { testSuite as testDoubleGeneratorTestSuite } from '../../doubles/test-double-generator.test.ts';
import { testSuite as testDoubleHistoryTestSuite } from '../../doubles/test-double-history.test.ts';
import { testSuite as testDoubleHistoryRuntimeTestSuite } from '../../doubles/test-double-history-runtime.test.ts';
import { testSuite as testDoubleTestSuite } from '../../doubles/test-double.test.ts';

export const testSuite = createSuite({
    name: 'source/test-support/unit-suite-groups/test-double-runtime.ts',
    metadata: {},
    children: [
        doubleHistoryEmptyTestSuite,
        testDoubleCallbackTestSuite,
        testDoubleConfigurationTestSuite,
        testDoubleConstructionTestSuite,
        testDoubleGeneratorTestSuite,
        testDoubleHistoryRuntimeTestSuite,
        testDoubleHistoryTestSuite,
        testDoubleTestSuite
    ]
});
