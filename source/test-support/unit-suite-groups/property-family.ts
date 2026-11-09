import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as differentialTestNode } from '../../differential/differential.test.ts';
import { testNode as modelTestNode } from '../../model/model.test.ts';
import { testNode as propertyTestNode } from '../../property/property-suite.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [ differentialTestNode, modelTestNode, propertyTestNode ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'property family'
});
