import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as replayExecution } from './replay-suite.test.ts';
import { testNode as operations } from './history.test.ts';
import { testNode as cli } from './history-cli.test.ts';
import { testNode as boundaries } from './history-boundaries.test.ts';
import { testNode as replayTerminal } from './replay-terminal.test.ts';
import { testNode as replay } from './replay-command.test.ts';
import { testNode as terminal } from './history-terminal.test.ts';

import { testNode as operands } from './replay-operands.test.ts';

export const testNode = createSuite({
    title: 'history commands',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ replayExecution, operations, cli, boundaries, terminal, replay, replayTerminal, operands ]
});
await runIfMain(import.meta, testNode);
