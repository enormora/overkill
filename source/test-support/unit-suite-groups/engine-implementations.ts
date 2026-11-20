import { suite } from '@overkill-dev/test';
import { testNode as assignments } from '../../implementation-assignment-policy.test.ts';
import { testNode as catalogPolicy } from '../../implementation-catalog-policy.test.ts';
import { testNode as bodyPlanning } from '../../engine/body-reference-plan-policy.test.ts';
import { testNode as graphPolicy } from '../../implementation-graph-policy.test.ts';
import { testNode as portableRunTests } from '../../run/portable-run-suite.test.ts';

import { testNode as engineTests } from '../../engine/engine.test.ts';
import { testNode as graphTests } from '../../implementation-resolution-suite.test.ts';
import { testNode as referenceTests } from '../../implementation-reference.test.ts';

export const testNode = suite('source/test-support/unit-suite-groups/engine-implementations.ts', [
    assignments,
    graphPolicy,
    bodyPlanning,
    catalogPolicy,
    portableRunTests,
    engineTests,
    graphTests,
    referenceTests
]);
