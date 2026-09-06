import { createLineReporter as createOverkillLineReporter } from './packages/reporter-line/reporter-line.entry-point.ts';
import { createSuite, runIfMain } from './packages/engine/engine.entry-point.ts';
import { testSuite as assertAndRunTestSuite } from './test-support/unit-suite-groups/assert-and-run.ts';
import { testSuite as compareTestSuite } from './test-support/unit-suite-groups/compare.ts';
import { testSuite as doublesTestSuite } from './test-support/unit-suite-groups/doubles.ts';
import { testSuite as engineCoreTestSuite } from './test-support/unit-suite-groups/engine-core.ts';
import { testSuite as engineSupportTestSuite } from './test-support/unit-suite-groups/engine-support.ts';
import { testSuite as outputRenderersTestSuite } from './test-support/unit-suite-groups/output-renderers.ts';
import { testSuite as reportersTestSuite } from './test-support/unit-suite-groups/reporters.ts';

export const testSuite = createSuite({
    title: 'source/overkill.test.ts',
    metadata: {},
    children: [
        assertAndRunTestSuite,
        compareTestSuite,
        doublesTestSuite,
        engineCoreTestSuite,
        engineSupportTestSuite,
        outputRenderersTestSuite,
        reportersTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
