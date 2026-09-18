import { createSuite } from './packages/engine/engine.entry-point.ts';
import { testNode as assertAndRunTestNode } from './test-support/unit-suite-groups/assert-and-run.ts';
import { testNode as compareTestNode } from './test-support/unit-suite-groups/compare.ts';
import { testNode as doublesTestNode } from './test-support/unit-suite-groups/doubles.ts';
import { testNode as engineCoreTestNode } from './test-support/unit-suite-groups/engine-core.ts';
import { testNode as engineSupportTestNode } from './test-support/unit-suite-groups/engine-support.ts';
import { testNode as outputRenderersTestNode } from './test-support/unit-suite-groups/output-renderers.ts';
import { testNode as reportersTestNode } from './test-support/unit-suite-groups/reporters.ts';
import { testNode as resourcesTestNode } from './test-support/unit-suite-groups/resources.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/overkill.test.ts',
    annotations: {},
    controls: {},
    children: [
        assertAndRunTestNode,
        compareTestNode,
        doublesTestNode,
        engineCoreTestNode,
        engineSupportTestNode,
        outputRenderersTestNode,
        reportersTestNode,
        resourcesTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('./test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
