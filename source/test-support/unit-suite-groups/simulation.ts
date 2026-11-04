import { testNode as witnessValidationTestNode } from '../../run/simulation-witness-validation.test.ts';
import { testNode as failureAttribution } from '../../resources/local-http-failure-attribution.test.ts';
import { testNode as failureCapture } from '../../resources/local-http-failure-capture.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as simulatedHttpServerTestNode } from '../../simulation/simulated-http-server.test.ts';
import { testNode as simulationTestNode } from '../../simulation/simulation.test.ts';
import { testNode as localHttpTranscriptTestNode } from '../../resources/local-http-transcript.test.ts';
import { testNode as transcriptStoreTestNode } from '../../transcript/transcript-store.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'simulation',
    annotations: {},
    controls: {},
    children: [
        witnessValidationTestNode,
        failureAttribution,
        failureCapture,
        simulationTestNode,
        simulatedHttpServerTestNode,
        localHttpTranscriptTestNode,
        transcriptStoreTestNode
    ]
});
