import { suite } from '@overkill-dev/test';

import { testNode as assertionExecutionCompositeTestNode } from '../../engine/assertion-execution-composite.test.ts';
import { testNode as assertionExecutionTestNode } from '../../engine/assertion-execution.test.ts';
import { testNode as assertionFacadeTestNode } from '../../engine/assertion-facade.test.ts';
import { testNode as deepAssertionOperandsTestNode } from '../../engine/deep-assertion-operands.test.ts';
import { testNode as errorAssertionExecutionTestNode } from '../../engine/error-assertion-execution.test.ts';
import { testNode as executionTestNode } from '../../engine/execution-suite.test.ts';
import { testNode as requireAssertionFacadeTestNode } from '../../engine/require-assertion-facade.test.ts';
import { testNode as globalErrors } from '../../engine/global-error-observation.test.ts';
import { testNode as engineTestNode } from './engine-implementations.ts';

export const testNode = suite('source/test-support/unit-suite-groups/engine-core.ts', [
    assertionExecutionCompositeTestNode,
    assertionExecutionTestNode,
    assertionFacadeTestNode,
    deepAssertionOperandsTestNode,
    engineTestNode,
    errorAssertionExecutionTestNode,
    executionTestNode,
    globalErrors,
    requireAssertionFacadeTestNode
]);
