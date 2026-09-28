import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as reporterDeliveryTestNode } from './reporter-delivery.test.ts';
import { testNode as reporterTimingDeliveryTestNode } from './reporter-timing-delivery.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/reporter-delivery-suite.test.ts',
    annotations: {},
    controls: {},
    children: [ reporterDeliveryTestNode, reporterTimingDeliveryTestNode ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
