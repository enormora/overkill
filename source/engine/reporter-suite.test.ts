import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as reporterManagedOutputTestNode } from './reporter-managed-output.test.ts';
import { testNode as reporterTestNode } from './reporter.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/reporter-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        reporterTestNode,
        reporterManagedOutputTestNode
    ]
});
