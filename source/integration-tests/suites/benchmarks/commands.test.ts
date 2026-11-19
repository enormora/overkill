import { suite } from '@overkill-dev/test';

import { testNode as benchmarkHostAdmissionTestNode } from '../../../run/benchmark-host-admission.test.ts';
import { testNode as benchmarkCommandsTestNode } from '../../../run/benchmark-commands.test.ts';

export const testNode = suite('benchmarks commands integration', [
    benchmarkHostAdmissionTestNode,
    benchmarkCommandsTestNode
]);
