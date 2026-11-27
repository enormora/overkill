import { mutationModes } from './mutation-project.test.ts';
import { createMutationCostSuite } from './mutation-cost-suite.test.ts';

export const testNode = createMutationCostSuite(5, true, mutationModes);
