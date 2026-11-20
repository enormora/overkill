import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as workflow } from './snapshot-workflow-policy.test.ts';
import { testNode as runtime } from './snapshot-runtime.test.ts';

export const testNode = authoredSuite('content snapshots', [ workflow, runtime ]);
