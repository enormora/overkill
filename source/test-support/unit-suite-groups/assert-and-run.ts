import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as assertionExtensionTestNode } from '../../assert/assertion-extension.test.ts';
import { testNode as assertionNodeShapeTestNode } from '../../assertion-protocol/assertion-node-shape.test.ts';
import { testNode as evaluationTestNode } from '../../assertion-protocol/evaluation.test.ts';
import { testNode as partialMatchingTestNode } from '../../assertion-protocol/partial-matching.test.ts';
import { testNode as sourceLocationTestNode } from '../../assertion-protocol/source-location.test.ts';
import { testNode as testPackageTestNode } from '../../packages/test/test-suite.test.ts';
import { testNode as commandLineListTestNode } from '../../run/command-line-list-suite.test.ts';
import { testNode as runTestNode } from '../../run/run-suite.test.ts';
import { testNode as runResultFactoryTestNode } from '../run-result-factory.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'assertion protocol, assert, run, and test support',
    annotations: {},
    controls: {},
    children: [
        assertionExtensionTestNode,
        assertionNodeShapeTestNode,
        evaluationTestNode,
        partialMatchingTestNode,
        sourceLocationTestNode,
        testPackageTestNode,
        commandLineListTestNode,
        runTestNode,
        runResultFactoryTestNode
    ]
});
