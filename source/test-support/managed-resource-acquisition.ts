import { defineResource, type AnyResourceDefinition } from '../resources/resources.ts';
import {
    createManagedStores,
    createManagedResourceAcquirer,
    type ManagedLifecycleStores,
    type ManagedResourceAcquirer,
    type ManagedResourceRecord
} from '../run/resource-lifecycle-session-acquirer.ts';
import { boundaryFor } from '../run/resource-lifecycle-boundaries.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { ResourceProjectionRecords } from '../run/resource-lifecycle-projection.ts';
import { createTestEngine } from './create-test-engine.ts';

export function managedCase(): TestPlanCase {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(
        engine.createRoot({
            title: 'owner',
            annotations: {},
            controls: {},
            children: [
                engine.createTestCase({
                    title: 'case',
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    body() {
                        throw new Error('Acquisition must not execute the test body.');
                    }
                })
            ]
        })
    );
    const testCase = plan.cases[0];
    return testCase;
}
export function managedDescriptor(acquire: () => unknown): AnyResourceDefinition {
    return defineResource({ name: 'owner', scope: 'per-case', requirements: [], dispose: null, acquire });
}
type ManagedAcquisitionFixture = {
    readonly testCase: TestPlanCase;
    readonly stores: ManagedLifecycleStores;
    readonly acquirer: ManagedResourceAcquirer;
    readonly acquire: (resource: AnyResourceDefinition) => Promise<ManagedResourceRecord>;
};
export function managedAcquisition(projectedResources: ResourceProjectionRecords): ManagedAcquisitionFixture {
    const testCase = managedCase();
    const options = {
        testCases: [ testCase ],
        boundaryUseCounts: [ { boundaryKey: 'retained', count: 2 } ],
        projectedResources,
        timing: null
    };
    const stores = createManagedStores(options);
    const acquirer = createManagedResourceAcquirer(stores, options);
    return {
        testCase,
        stores,
        acquirer,
        async acquire(resource) {
            const controller = new AbortController();
            return await acquirer.acquire(resource, testCase, controller.signal);
        }
    };
}
export function managedRecord(resource: AnyResourceDefinition, testCase: TestPlanCase): ManagedResourceRecord {
    return {
        releaseOwner() {
            return undefined;
        },
        checks: null,
        boundary: boundaryFor(resource, testCase),
        dependencyContext: {},
        descriptor: resource,
        external: false,
        ownerHandle: 'owner',
        replayScenario: null,
        consumerHandle: 'consumer'
    };
}
