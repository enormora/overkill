import { testNode as implementations } from '../../resources/resource-implementation-binding.test.ts';
import { testNode as timingPolicy } from '../../run/resource-lifecycle-timing-policy.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as resourceFailure } from '../../run/resource-failure-capture.test.ts';
import { testNode as witnessValidation } from '../../run/simulation-witness-validation.test.ts';
import { testNode as httpFailure } from '../../resources/local-http-failure-capture.test.ts';

export const testNode = createSuite({
    title: 'resource failure evidence',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        implementations,
        timingPolicy,
        resourceFailure,
        witnessValidation,
        httpFailure
    ]
});
