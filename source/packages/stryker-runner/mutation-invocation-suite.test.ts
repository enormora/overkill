import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as initialization } from './mutation-initialization-policy.test.ts';
import { testNode as receiver } from './campaign-receiver-policy.test.ts';
import { testNode as lifecycle } from './mutation-runner-lifecycle.test.ts';
import { testNode as diagnostics } from './mutation-diagnostic-policy.test.ts';
import { testNode as invocations } from './mutation-runner-invocations.test.ts';
import { testNode as execution } from './mutation-runner-execution.test.ts';
import { testNode as policy } from './mutation-policy-resolution.test.ts';
import { testNode as protocol } from './mutation-policy-protocol.test.ts';

export const testNode = authoredSuite('mutation adapter invocation contracts', [
    initialization,
    lifecycle,
    receiver,
    diagnostics,
    invocations,
    execution,
    policy,
    protocol
]);
