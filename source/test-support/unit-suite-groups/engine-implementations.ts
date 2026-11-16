import { testNode as portableRunTests } from '../../run/portable-run-suite.test.ts';
import { testNode as familyReferenceTests } from '../../engine/body-reference-families.test.ts';
import { testNode as catalogTestNode } from '../../implementation-catalog.test.ts';
import { testNode as resourceExecutionTests } from '../../engine/resource-reference-execution.test.ts';
import { testNode as resourceReferenceTests } from '../../resources/resource-reference.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as engineTests } from '../../engine/engine.test.ts';
import { testNode as bodyReferenceTests } from '../../engine/body-reference.test.ts';
import { testNode as graphTests } from '../../implementation-resolution-suite.test.ts';
import { testNode as referenceTests } from '../../implementation-reference.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/engine-implementations.ts',
    annotations: {},
    controls: {},
    children: [
        portableRunTests,
        catalogTestNode,
        engineTests,
        bodyReferenceTests,
        familyReferenceTests,
        graphTests,
        referenceTests,
        resourceReferenceTests,
        resourceExecutionTests
    ]
});
