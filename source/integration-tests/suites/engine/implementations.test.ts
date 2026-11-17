import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as bodyReferenceFamiliesTestNode } from '../../../engine/body-reference-families.test.ts';
import { testNode as implementationCatalogTestNode } from '../../../implementation-catalog.test.ts';
import { testNode as resourceReferenceExecutionTestNode } from '../../../engine/resource-reference-execution.test.ts';
import { testNode as bodyReferenceTestNode } from '../../../engine/body-reference.test.ts';
import { testNode as implementationGraphTestNode } from '../../../implementation-graph.test.ts';
import { testNode as implementationCancellationTestNode } from '../../../implementation-cancellation.test.ts';
import { testNode as implementationSourceMapTestNode } from '../../../implementation-source-map.test.ts';
import { testNode as implementationAdmissionTestNode } from '../../../implementation-admission.test.ts';

export const testNode = createSuite({
    title: 'engine implementations integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        bodyReferenceFamiliesTestNode,
        implementationCatalogTestNode,
        resourceReferenceExecutionTestNode,
        bodyReferenceTestNode,
        implementationGraphTestNode,
        implementationCancellationTestNode,
        implementationSourceMapTestNode,
        implementationAdmissionTestNode
    ]
});
