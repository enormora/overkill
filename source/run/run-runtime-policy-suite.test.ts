import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as snapshotTestNode } from './capability-policy-snapshots.test.ts';
import { testNode as runtimePolicyTestNode } from './run-runtime-policy.test.ts';

export const testNode = authoredSuite('runtime policy', [ snapshotTestNode, runtimePolicyTestNode ]);
