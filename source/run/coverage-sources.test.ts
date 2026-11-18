import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as startup } from './coverage-startup-policy.test.ts';
import { testNode as runtimeSourceTestNode } from './coverage-runtime-source.test.ts';
import { testNode as methodRangesTestNode } from './coverage-method-ranges.test.ts';
import { testNode as loadedSources } from './coverage-loaded-sources.test.ts';
import { testNode as sourceSelection } from './coverage-source-selection.test.ts';

import { testNode as backends } from './coverage-report-backends.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'coverage source selection',
    children: [
        startup,
        backends,
        loadedSources,
        sourceSelection,
        runtimeSourceTestNode,
        methodRangesTestNode
    ]
});

await runIfMain(import.meta, testNode);
