import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as streams } from '../attachments/failure-artifact-stream.test.ts';
import { testNode as collectors } from './resource-failure-capture.test.ts';
import { testNode as resources } from './integration-failure-artifacts.test.ts';
import { testNode as sharing } from './failure-artifact-sharing.test.ts';
import { testNode as preparation } from './resource-failure-preparation.test.ts';
import { testNode as processes } from './process-failure-evidence.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'integration failure artifacts',
    children: [ streams, collectors, resources, sharing, preparation, processes ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
