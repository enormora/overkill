import { suite } from '@overkill-dev/test';
import { testNode as simulation } from '../../resources/simulated-http-resource-policy.test.ts';

import { testNode as processService } from '../../resources/local-process-service-policy.test.ts';
import { testNode as observation } from '../../resources/local-http-transcript-observer.test.ts';
import { testNode as http } from '../../resources/local-http-service-resource.test.ts';
import { testNode as processOutput } from '../../resources/local-process-output.test.ts';

export const testNode = suite('local service policy', [ simulation, observation, http, processOutput, processService ]);
