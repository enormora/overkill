import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as asyncControlTestNode } from '../../engine/async-control.test.ts';
import { testNode as assertionExecutionCompositeTestNode } from '../../engine/assertion-execution-composite.test.ts';
import { testNode as assertionExecutionTestNode } from '../../engine/assertion-execution.test.ts';
import { testNode as assertionFacadeTestNode } from '../../engine/assertion-facade.test.ts';
import { testNode as deepAssertionOperandsTestNode } from '../../engine/deep-assertion-operands.test.ts';
import { testNode as engineTestNode } from '../../engine/engine.test.ts';
import { testNode as errorAssertionExecutionTestNode } from '../../engine/error-assertion-execution.test.ts';
import { testNode as executionTestNode } from '../../engine/execution-suite.test.ts';
import { testNode as requireAssertionFacadeTestNode } from '../../engine/require-assertion-facade.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/engine-core.ts',
    annotations: {},
    controls: {},
    children: [
        asyncControlTestNode,
        assertionExecutionCompositeTestNode,
        assertionExecutionTestNode,
        assertionFacadeTestNode,
        deepAssertionOperandsTestNode,
        engineTestNode,
        errorAssertionExecutionTestNode,
        executionTestNode,
        requireAssertionFacadeTestNode
    ]
});
