import { suite } from '@overkill-dev/test';

import { testNode as replayTerminalTestNode } from '../../../run/replay-terminal.test.ts';
import { testNode as replayCommandTestNode } from '../../../run/replay-command.test.ts';
import { testNode as replayOperandsTestNode } from '../../../run/replay-operands.test.ts';
import { testNode as runnerReplayCompatibilityTestNode } from '../../run/runner-replay-compatibility.test.ts';
import { testNode as runnerReplayTestNode } from '../../run/runner-replay.test.ts';
import { testNode as runnerReplaySimulationTestNode } from '../../run/runner-replay-simulation.test.ts';
import { testNode as runnerDebugReplayTestNode } from '../../run/runner-debug-replay.test.ts';
import { testNode as runnerReplayCoverageTestNode } from '../../run/runner-replay-coverage.test.ts';

export const testNode = suite('persistence replay integration', [
    replayTerminalTestNode,
    replayCommandTestNode,
    replayOperandsTestNode,
    runnerReplayCompatibilityTestNode,
    runnerReplayTestNode,
    runnerReplaySimulationTestNode,
    runnerDebugReplayTestNode,
    runnerReplayCoverageTestNode
]);
