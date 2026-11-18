import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as nativeRecords } from './native-resource-recording.test.ts';
import { testNode as disabledObservation } from './disabled-error-observation.test.ts';
import { testNode as failureArtifactPolicyTestNode } from './failure-artifact-policy.test.ts';
import { testNode as timeoutSupervisionTestNode } from './execution-timeout-supervision.test.ts';
import { testNode as retryExecutionTestNode } from './retry-execution.test.ts';
import { testNode as interruptedCleanupTestNode } from './interrupted-case-cleanup.test.ts';
import { testNode as asyncOwnership } from './async-ownership.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/execution-supervision-suite.test.ts',
    children: [
        nativeRecords,
        disabledObservation,
        asyncOwnership,
        failureArtifactPolicyTestNode,
        timeoutSupervisionTestNode,
        retryExecutionTestNode,
        interruptedCleanupTestNode
    ]
});
await runIfMain(import.meta, testNode);
