import { createSuite } from '@overkill-dev/engine';
import { testSuite as assertionExecutionCompositeTestSuite } from '../../engine/assertion-execution-composite.test.ts';
import { testSuite as assertionExecutionTestSuite } from '../../engine/assertion-execution.test.ts';
import { testSuite as assertionFacadeTestSuite } from '../../engine/assertion-facade.test.ts';
import { testSuite as deepAssertionOperandsTestSuite } from '../../engine/deep-assertion-operands.test.ts';
import { testSuite as engineTestSuite } from '../../engine/engine.test.ts';
import { testSuite as errorAssertionExecutionTestSuite } from '../../engine/error-assertion-execution.test.ts';
import { testSuite as executionTestSuite } from '../../engine/execution-suite.test.ts';
import { testSuite as requireAssertionFacadeTestSuite } from '../../engine/require-assertion-facade.test.ts';

export const testSuite = createSuite({
    name: 'source/test-support/unit-suite-groups/engine-core.ts',
    metadata: {},
    children: [
        assertionExecutionCompositeTestSuite,
        assertionExecutionTestSuite,
        assertionFacadeTestSuite,
        deepAssertionOperandsTestSuite,
        engineTestSuite,
        errorAssertionExecutionTestSuite,
        executionTestSuite,
        requireAssertionFacadeTestSuite
    ]
});
