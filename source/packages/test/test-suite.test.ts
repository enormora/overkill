import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as commandLineRunnerCaptureTestNode } from './command-line-runner-capture.test.ts';
import { testNode as commandLineRunnerTestNode } from './command-line-runner.test.ts';
import { testNode as harnessAuthoringTestNode } from './harness-authoring.test.ts';
import { testNode as standardSubpathsTestNode } from './standard-subpaths.test.ts';
import { testNode as skippedTestEntryPointTestNode } from './skipped-test-entry-point.test.ts';
import { testNode as entryPointTestNode } from './test-entry-point.test.ts';
import { testNode as facadeEntryPointTestNode } from './test-facade-entry-point.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test',
    metadata: {},
    children: [
        commandLineRunnerCaptureTestNode,
        commandLineRunnerTestNode,
        harnessAuthoringTestNode,
        standardSubpathsTestNode,
        skippedTestEntryPointTestNode,
        entryPointTestNode,
        facadeEntryPointTestNode
    ]
});
