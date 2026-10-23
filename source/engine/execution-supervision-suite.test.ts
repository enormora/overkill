import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as globalErrorObserverTestNode } from './execution-global-error-observer.test.ts';
import { testNode as nativeGuardOwnershipTestNode } from './native-guard-ownership.test.ts';
import { testNode as nativeErrorOwnershipTestNode } from './native-error-ownership.test.ts';
import { testNode as timeoutSupervisionTestNode } from './execution-timeout-supervision.test.ts';
import { testNode as retryExecutionTestNode } from './retry-execution.test.ts';
import { testNode as interruptedCleanupTestNode } from './interrupted-case-cleanup.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/execution-supervision-suite.test.ts',
    children: [
        globalErrorObserverTestNode,
        nativeGuardOwnershipTestNode,
        nativeErrorOwnershipTestNode,
        timeoutSupervisionTestNode,
        retryExecutionTestNode,
        interruptedCleanupTestNode
    ]
});
await runIfMain(import.meta, testNode);
