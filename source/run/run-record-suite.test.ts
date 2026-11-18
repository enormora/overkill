import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as resultTestNode } from './run-record-result.test.ts';
import { testNode as recordTestNode } from './run-record.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-record-suite.test.ts',
    annotations: {},
    controls: {},
    children: [ resultTestNode, recordTestNode ]
});
await runIfMain(import.meta, testNode);
