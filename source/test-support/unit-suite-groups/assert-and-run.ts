import { createSuite } from '@overkill-dev/engine';
import { testSuite as assertionExtensionTestSuite } from '../../assert/assertion-extension.test.ts';
import { testSuite as assertionNodeShapeTestSuite } from '../../assertion-protocol/assertion-node-shape.test.ts';
import { testSuite as evaluationTestSuite } from '../../assertion-protocol/evaluation.test.ts';
import { testSuite as partialMatchingTestSuite } from '../../assertion-protocol/partial-matching.test.ts';
import { testSuite as sourceLocationTestSuite } from '../../assertion-protocol/source-location.test.ts';
import { testSuite as runTestSuite } from '../../run/run.test.ts';
import { testSuite as runResultFactoryTestSuite } from '../run-result-factory.test.ts';

export const testSuite = createSuite({
    name: 'assertion protocol, assert, run, and test support',
    metadata: {},
    children: [
        assertionExtensionTestSuite,
        assertionNodeShapeTestSuite,
        evaluationTestSuite,
        partialMatchingTestSuite,
        sourceLocationTestSuite,
        runTestSuite,
        runResultFactoryTestSuite
    ]
});
