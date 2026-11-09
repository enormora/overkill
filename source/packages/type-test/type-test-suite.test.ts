import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as orchestration } from '../../run/adapter-execution.test.ts';
import { testNode as matrix } from './compiler-matrix.test.ts';
import { testNode as planning } from './compiler-plan.test.ts';
import { testNode as frozen } from './frozen-inputs.test.ts';
import { testNode as generated } from './generated-input-suite.test.ts';
import { testNode as adapter } from './adapter.test.ts';
import { testNode as origins } from './body-origin.test.ts';
import { testNode as assertions } from './assertion-reference.test.ts';

export const testNode = createSuite({
    title: 'type-test integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ matrix, planning, frozen, generated, adapter, origins, assertions, orchestration ]
});
