import { suite } from '@overkill-dev/test';
import { testNode as selection } from '../../packages/type-test/compiler-selection.test.ts';

import { testNode as compilerMatrixTestNode } from '../../packages/type-test/compiler-matrix.test.ts';
import { testNode as compilerPlanTestNode } from '../../packages/type-test/compiler-plan.test.ts';
import { testNode as frozenInputsTestNode } from '../../packages/type-test/frozen-inputs.test.ts';
import { testNode as adapterTestNode } from '../../packages/type-test/adapter.test.ts';

import { testNode as originalRelations } from '../../packages/type-test/original-relations.test.ts';

import { testNode as relations } from '../../packages/type-test/relation-forms.test.ts';
import { testNode as lifetime } from '../../packages/type-test/compiler-lifetime.test.ts';

export const testNode = suite('compiler integration', [
    selection,
    compilerMatrixTestNode,
    compilerPlanTestNode,
    frozenInputsTestNode,
    adapterTestNode,
    originalRelations,
    relations,
    lifetime
]);
