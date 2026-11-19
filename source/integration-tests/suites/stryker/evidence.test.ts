import { suite } from '@overkill-dev/test';

import { testNode as runnerOptionsTestNode } from '../../../packages/stryker-runner/runner-options.test.ts';
import { testNode as mutationBaselineTestNode } from '../../../packages/stryker-runner/mutation-baseline.test.ts';
import { testNode as runnerStrykerCatalogTestNode } from '../../run/runner-stryker-catalog.test.ts';
import { testNode as runnerStrykerDryRunTestNode } from '../../run/runner-stryker-dry-run.test.ts';
import { testNode as runnerStrykerClassificationTestNode } from '../../run/runner-stryker-classification.test.ts';

export const testNode = suite('stryker evidence integration', [
    runnerOptionsTestNode,
    mutationBaselineTestNode,
    runnerStrykerCatalogTestNode,
    runnerStrykerDryRunTestNode,
    runnerStrykerClassificationTestNode
]);
