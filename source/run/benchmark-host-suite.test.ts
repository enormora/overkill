import { suite } from '@overkill-dev/test';

import { testNode as platformPressure } from './platform-pressure-policy.test.ts';
import { testNode as hostReportTestNode } from './benchmark-host-report.test.ts';
import { testNode as garbageCollectionPolicyTestNode } from './benchmark-garbage-collection.test.ts';
import { testNode as hostTestNode } from './benchmark-host.test.ts';
import { testNode as hostUnavailableTestNode } from './benchmark-host-unavailable.test.ts';

export const testNode = suite('benchmark host observations', [
    platformPressure,
    garbageCollectionPolicyTestNode,
    hostTestNode,
    hostReportTestNode,
    hostUnavailableTestNode
]);
