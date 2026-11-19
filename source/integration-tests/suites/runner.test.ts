import { suite } from '@overkill-dev/test';

import { testNode as cliTestNode } from './runner/cli.test.ts';
import { testNode as runtimeTestNode } from './runner/runtime.test.ts';
import { testNode as outputTestNode } from './runner/output.test.ts';
import { testNode as policyTestNode } from './runner/policy.test.ts';

export const testNode = suite('runner integration', [ cliTestNode, runtimeTestNode, outputTestNode, policyTestNode ]);
