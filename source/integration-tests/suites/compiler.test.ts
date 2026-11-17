import { testNode as selection } from '../../packages/type-test/compiler-selection.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as compilerMatrixTestNode } from '../../packages/type-test/compiler-matrix.test.ts';
import { testNode as compilerPlanTestNode } from '../../packages/type-test/compiler-plan.test.ts';
import { testNode as frozenInputsTestNode } from '../../packages/type-test/frozen-inputs.test.ts';
import { testNode as adapterTestNode } from '../../packages/type-test/adapter.test.ts';
import { testNode as checkerTestNode } from '../../packages/type-test/checker.test.ts';

import { testNode as originalRelations } from '../../packages/type-test/original-relations.test.ts';

export const testNode = createSuite({
    title: 'compiler integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        selection,
        compilerMatrixTestNode,
        compilerPlanTestNode,
        frozenInputsTestNode,
        adapterTestNode,
        checkerTestNode,
        originalRelations
    ]
});
