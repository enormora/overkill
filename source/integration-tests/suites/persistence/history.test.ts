import { testNode as access } from '../../../run/history-state-access.test.ts';
import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as nodeHistoryStorageTestNode } from '../../../run/node-history-storage.test.ts';
import { testNode as historyTestNode } from '../../../run/history.test.ts';
import { testNode as historyCliTestNode } from '../../../run/history-cli.test.ts';
import { testNode as historyBoundariesTestNode } from '../../../run/history-boundaries.test.ts';
import { testNode as historyTerminalTestNode } from '../../../run/history-terminal.test.ts';
import { testNode as historyMaintenanceTestNode } from '../../../run/history-maintenance.test.ts';
import { testNode as historyPruningTestNode } from '../../../run/history-pruning.test.ts';

export const testNode = createSuite({
    title: 'persistence history integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        access,
        nodeHistoryStorageTestNode,
        historyTestNode,
        historyCliTestNode,
        historyBoundariesTestNode,
        historyTerminalTestNode,
        historyMaintenanceTestNode,
        historyPruningTestNode
    ]
});
