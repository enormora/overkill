import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as operations } from './history.test.ts';
import { testNode as cli } from './history-cli.test.ts';

export const testNode = createSuite({
    title: 'history commands',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ operations, cli ]
});
await runIfMain(import.meta, testNode);
