import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as benchEntryPointTestNode } from '../../packages/bench/bench-entry-point.test.ts';
import { testNode as benchEngineCopiesTestNode } from '../../packages/bench/bench-engine-copies.test.ts';
import { testNode as benchMacroLocationsTestNode } from '../../packages/bench/bench-macro-locations.test.ts';
import { testNode as testPackageTestNode } from '../../packages/test/test-suite.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [ testPackageTestNode, benchEntryPointTestNode, benchEngineCopiesTestNode, benchMacroLocationsTestNode ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'authoring'
});
