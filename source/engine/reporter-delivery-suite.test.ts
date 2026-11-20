import { suite } from '@overkill-dev/test';

import { testNode as violationPolicy } from './reporter-violation-policy.test.ts';
import { testNode as preparation } from './final-reporter-preparation.test.ts';
import { testNode as reporterObservationTestNode } from './reporter-observation.test.ts';
import { testNode as reporterDeliveryTestNode } from './reporter-delivery.test.ts';
import { testNode as reporterTimingDeliveryTestNode } from './reporter-timing-delivery.test.ts';

export const testNode = suite('source/engine/reporter-delivery-suite.test.ts', [
    violationPolicy,
    preparation,
    reporterDeliveryTestNode,
    reporterTimingDeliveryTestNode,
    reporterObservationTestNode
]);
