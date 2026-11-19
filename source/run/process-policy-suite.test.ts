import { suite } from '@overkill-dev/test';

import { testNode as transportTestNode } from './supervised-child-transport.test.ts';
import { testNode as schemas } from './child-process-schema.test.ts';
import { testNode as shutdown } from './child-process-shutdown.test.ts';

export const testNode = suite('native process policy', [ transportTestNode, schemas, shutdown ]);
