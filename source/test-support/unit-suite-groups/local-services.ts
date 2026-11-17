import { testNode as simulation } from '../../resources/simulated-http-resource-policy.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as processService } from '../../resources/local-process-service-policy.test.ts';
import { testNode as observation } from '../../resources/local-http-transcript-observer.test.ts';
import { testNode as http } from '../../resources/local-http-service-resource.test.ts';
import { testNode as processOutput } from '../../resources/local-process-output.test.ts';

export const testNode = createSuite({
    title: 'local service policy',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ simulation, observation, http, processOutput, processService ]
});
