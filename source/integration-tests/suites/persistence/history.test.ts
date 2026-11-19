import { suite } from '@overkill-dev/test';
import { testNode as access } from '../../../run/history-state-access.test.ts';

import { testNode as nodeHistoryStorageTestNode } from '../../../run/node-history-storage.test.ts';
import { testNode as historyTestNode } from '../../../run/history.test.ts';
import { testNode as historyCliTestNode } from '../../../run/history-cli.test.ts';
import { testNode as historyBoundariesTestNode } from '../../../run/history-boundaries.test.ts';
import { testNode as historyTerminalTestNode } from '../../../run/history-terminal.test.ts';
import { testNode as historyMaintenanceTestNode } from '../../../run/history-maintenance.test.ts';
import { testNode as historyPruningTestNode } from '../../../run/history-pruning.test.ts';

export const testNode = suite('persistence history integration', [
    access,
    nodeHistoryStorageTestNode,
    historyTestNode,
    historyCliTestNode,
    historyBoundariesTestNode,
    historyTerminalTestNode,
    historyMaintenanceTestNode,
    historyPruningTestNode
]);
