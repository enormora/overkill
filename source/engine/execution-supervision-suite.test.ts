import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as globalErrorObserverTestNode } from './execution-global-error-observer.test.ts';
import { testNode as timeoutSupervisionTestNode } from './execution-timeout-supervision.test.ts';
import { testNode as retryExecutionTestNode } from './retry-execution.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/execution-supervision-suite.test.ts',
    children: [ globalErrorObserverTestNode, timeoutSupervisionTestNode, retryExecutionTestNode ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
