import { suite } from '@overkill-dev/test';

import { testNode as localServiceResourceTestNode } from '../../../resources/local-service-resource.test.ts';
import { testNode as simulatedHttpServerResourceTestNode } from '../../../resources/simulated-http-server-resource.test.ts';
import { testNode as localHttpFailureAttributionTestNode } from '../../../resources/local-http-failure-attribution.test.ts';
import { testNode as simulatedHttpServerTestNode } from '../../../simulation/simulated-http-server.test.ts';
import { testNode as localHttpTranscriptTestNode } from '../../../resources/local-http-transcript.test.ts';

export const testNode = suite('resources http integration', [
    localServiceResourceTestNode,
    simulatedHttpServerResourceTestNode,
    localHttpFailureAttributionTestNode,
    simulatedHttpServerTestNode,
    localHttpTranscriptTestNode
]);
