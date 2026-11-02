import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as operations } from './history.test.ts';
import { testNode as cli } from './history-cli.test.ts';
import { testNode as boundaries } from './history-boundaries.test.ts';
import { testNode as replayTerminal } from './replay-terminal.test.ts';
import { testNode as replay } from './replay-command.test.ts';
import { testNode as terminal } from './history-terminal.test.ts';

export const testNode = createSuite({
    title: 'history commands',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ operations, cli, boundaries, terminal, replay, replayTerminal ]
});
await runIfMain(import.meta, testNode);
