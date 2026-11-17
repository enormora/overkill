import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as workflow } from './snapshot-workflow-policy.test.ts';
import { testNode as runtime } from './snapshot-runtime.test.ts';

export const testNode = suite('content snapshots', [ workflow, runtime ]);
