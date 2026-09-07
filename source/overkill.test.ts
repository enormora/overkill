import { createSuite } from './packages/engine/engine.entry-point.ts';
import { testNode as assertAndRunTestNode } from './test-support/unit-suite-groups/assert-and-run.ts';
import { testNode as compareTestNode } from './test-support/unit-suite-groups/compare.ts';
import { testNode as doublesTestNode } from './test-support/unit-suite-groups/doubles.ts';
import { testNode as engineCoreTestNode } from './test-support/unit-suite-groups/engine-core.ts';
import { testNode as engineSupportTestNode } from './test-support/unit-suite-groups/engine-support.ts';
import { testNode as outputRenderersTestNode } from './test-support/unit-suite-groups/output-renderers.ts';
import { testNode as reportersTestNode } from './test-support/unit-suite-groups/reporters.ts';

export const testNode = createSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/overkill.test.ts',
    metadata: {},
    children: [
        assertAndRunTestNode,
        compareTestNode,
        doublesTestNode,
        engineCoreTestNode,
        engineSupportTestNode,
        outputRenderersTestNode,
        reportersTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('./test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
