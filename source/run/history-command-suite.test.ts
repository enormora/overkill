import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as replayExecution } from './replay-suite.test.ts';

export const testNode = createSuite({
    title: 'history commands',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ replayExecution ]
});
await runIfMain(import.meta, testNode);
