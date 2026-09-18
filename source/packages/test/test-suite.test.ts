import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as commandLineRunnerSuiteTestNode } from './command-line-runner-suite.test.ts';
import { testNode as compatibilityTestNode } from './compatibility-suite.test.ts';
import { testNode as harnessAuthoringTestNode } from './harness-authoring.test.ts';
import { testNode as interactionTranscriptTestNode } from './interaction-transcript.test.ts';
import { testNode as resourceSuiteTestNode } from './resource-suite.test.ts';
import { testNode as entryPointTestNode } from './test-entry-point.test.ts';
import { testNode as facadeEntryPointTestNode } from './test-facade-entry-point.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test',
    annotations: {},
    controls: {},
    children: [
        commandLineRunnerSuiteTestNode,
        compatibilityTestNode,
        harnessAuthoringTestNode,
        interactionTranscriptTestNode,
        resourceSuiteTestNode,
        entryPointTestNode,
        facadeEntryPointTestNode
    ]
});
