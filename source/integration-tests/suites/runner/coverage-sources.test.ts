import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as coverageTypeOnly } from '../../../run/coverage-type-only.test.ts';
import { testNode as coverageSourceMap } from '../../../run/coverage-source-map.test.ts';
import { testNode as coverageMapSelection } from '../../../run/coverage-map-selection.test.ts';
import { testNode as coverageUnloadedSources } from '../../../run/coverage-unloaded-sources.test.ts';
import { testNode as coverageMapContent } from '../../../run/coverage-map-content.test.ts';
import { testNode as coverageConformance } from '../../../run/coverage-conformance.test.ts';
import { testNode as coverageBranches } from '../../../run/coverage-branches.test.ts';

export const testNode = createSuite({
    title: 'coverage source integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        coverageTypeOnly,
        coverageSourceMap,
        coverageMapSelection,
        coverageUnloadedSources,
        coverageMapContent,
        coverageConformance,
        coverageBranches
    ]
});
