import { suite } from '@overkill-dev/test';

import { testNode as runSupervisedCoverage } from '../../../run/run-supervised-coverage.test.ts';
import { testNode as runRecordInvocation } from '../../../run/run-record-invocation.test.ts';
import { testNode as replayExecution } from '../../../run/replay-execution.test.ts';

export const testNode = suite('recording transport boundaries', [
    runSupervisedCoverage,
    runRecordInvocation,
    replayExecution
]);
