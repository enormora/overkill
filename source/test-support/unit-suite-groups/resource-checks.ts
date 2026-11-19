import { suite } from '@overkill-dev/test';
import { testNode as sessionPolicy } from '../../run/resource-check-session.test.ts';
import { testNode as checkRegistry } from '../../run/resource-check-registry.test.ts';
import { testNode as resourceCheckReportingTestNode } from '../../engine/resource-check-reporting.test.ts';
import { testNode as resourceCheckRecordsTestNode } from '../../run/resource-check-records.test.ts';
import { testNode as resourceCheckOutcomesTestNode } from '../../engine/resource-check-outcomes.test.ts';

export const testNode = suite('resource checks', [
    sessionPolicy,
    checkRegistry,
    resourceCheckReportingTestNode,
    resourceCheckRecordsTestNode,
    resourceCheckOutcomesTestNode
]);
