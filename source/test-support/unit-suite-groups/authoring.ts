import { testNode as measurementTestNode } from '../../bench/measurement-suite.test.ts';
import { testNode as workloadTestNode } from '../../bench/workload.test.ts';
import { testNode as baselinesTestNode } from '../../baselines/baselines-suite.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as benchEntryPointTestNode } from '../../packages/bench/bench-entry-point.test.ts';
import { testNode as benchEngineCopiesTestNode } from '../../packages/bench/bench-engine-copies.test.ts';
import { testNode as benchMacroLocationsTestNode } from '../../packages/bench/bench-macro-locations.test.ts';
import { testNode as testPackageTestNode } from '../../packages/test/test-suite.test.ts';
import { testNode as propertyAuthoringTestNode } from '../../property/property-authoring.test.ts';
import { testNode as propertyCompositionTestNode } from '../../property/property-composition.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [
        measurementTestNode,
        workloadTestNode,
        baselinesTestNode,
        testPackageTestNode,
        benchEntryPointTestNode,
        benchEngineCopiesTestNode,
        benchMacroLocationsTestNode,
        propertyAuthoringTestNode,
        propertyCompositionTestNode
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'authoring'
});
