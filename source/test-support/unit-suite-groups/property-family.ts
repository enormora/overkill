import { testNode as linearizabilityConfirmation } from '../../linearizability/linearizability-confirmation.test.ts';
import { testNode as linearizabilityComposition } from '../../linearizability/linearizability-composition.test.ts';
import { testNode as linearizabilityContracts } from '../../linearizability/linearizability-contract.test.ts';
import { testNode as linearizabilityAuthoring } from '../../linearizability/linearizability-authoring.test.ts';
import { testNode as admission } from '../../run/selection-collection-policy.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as differentialTestNode } from '../../differential/differential.test.ts';
import { testNode as modelTestNode } from '../../model/model.test.ts';
import { testNode as propertyTestNode } from '../../property/property-suite.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [
        admission,
        linearizabilityConfirmation,
        linearizabilityContracts,
        linearizabilityComposition,
        linearizabilityAuthoring,
        differentialTestNode,
        modelTestNode,
        propertyTestNode
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'property family'
});
