import { testNode as resourceCheckReportingTestNode } from '../../engine/resource-check-reporting.test.ts';
import { testNode as resourceCheckClientTestNode } from '../../run/resource-check-client.test.ts';
import { testNode as resourceCheckRegistryTestNode } from '../../run/resource-check-registry.test.ts';
import { testNode as resourceCheckRecordsTestNode } from '../../run/resource-check-records.test.ts';
import { testNode as resourceCheckOutcomesTestNode } from '../../engine/resource-check-outcomes.test.ts';
import { testNode as resourceCheckChannelTestNode } from '../../run/resource-check-channel.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as directResourceLifecycleTestNode } from '../../resources/direct-resource-lifecycle.test.ts';
import { testNode as resourceLifecycleDisposalTestNode } from '../../resources/resource-lifecycle-disposal.test.ts';
import { testNode as resourceLifecycleTestNode } from '../../resources/resource-lifecycle.test.ts';
import { testNode as localServiceResourceTestNode } from '../../resources/local-service-resource.test.ts';
import { testNode as resourceLifecycleRunSuiteTestNode } from '../../run/resource-lifecycle-run-suite.test.ts';
import { testNode as runtimeCompositionTestNode } from '../../resources/runtime-composition.test.ts';
import {
    testNode as simulatedHttpServerResourceTestNode
} from '../../resources/simulated-http-server-resource.test.ts';
import { testNode as resourcesTestNode } from '../../resources/resources.test.ts';
// eslint-disable-next-line import/max-dependencies -- This orchestration boundary consumes the resource-check protocol directly.
import { testNode as simulationTestNode } from './simulation.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'resources',
    annotations: {},
    controls: {},
    children: [
        resourceCheckReportingTestNode,
        resourceCheckClientTestNode,
        resourceCheckRegistryTestNode,
        resourceCheckRecordsTestNode,
        resourceCheckOutcomesTestNode,
        resourceCheckChannelTestNode,
        directResourceLifecycleTestNode,
        resourceLifecycleDisposalTestNode,
        resourceLifecycleTestNode,
        localServiceResourceTestNode,
        resourceLifecycleRunSuiteTestNode,
        runtimeCompositionTestNode,
        simulatedHttpServerResourceTestNode,
        resourcesTestNode,
        simulationTestNode
    ]
});
