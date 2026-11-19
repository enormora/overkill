import { suite } from '@overkill-dev/test';

import { testNode as parserPolicy } from './command-parser-policy.test.ts';
import { testNode as ordinaryBaselines } from './command-line-runner-baseline.test.ts';
import { testNode as witnessReplay } from './witness-replay-command.test.ts';
import { testNode as commandLineRunnerBenchTestNode } from './command-line-runner-bench.test.ts';
import { testNode as commandLineRunnerHelpTestNode } from './command-line-runner-help.test.ts';

export const testNode = suite('source/packages/test/command-line-runner-namespace-suite.test.ts', [
    parserPolicy,
    ordinaryBaselines,
    commandLineRunnerBenchTestNode,
    commandLineRunnerHelpTestNode,
    witnessReplay
]);
