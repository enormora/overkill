import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as runSupervisedCoverage } from '../../../run/run-supervised-coverage.test.ts';
import { testNode as runRecordInvocation } from '../../../run/run-record-invocation.test.ts';
import { testNode as replayExecution } from '../../../run/replay-execution.test.ts';

export const testNode = createSuite({
    title: 'recording transport boundaries',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ runSupervisedCoverage, runRecordInvocation, replayExecution ]
});
