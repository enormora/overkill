import type { TestPlanCase } from '../engine/test-plan.ts';
import { defineResource } from '../resources/resources.ts';
import type { ResourceCheckSession } from '../resources/resource-checks.ts';
import {
    createManagedStores,
    type ManagedLifecycleStores,
    type ManagedResourceRecord
} from '../run/resource-lifecycle-session-acquirer.ts';
import { managedCase, managedRecord } from './managed-resource-acquisition.ts';

type DisposalScenario = 'clean' | 'dispose-error' | 'finalize-error' | 'prepare-error';
function observation(record: (event: string) => void, scenario: DisposalScenario): ResourceCheckSession {
    return {
        assertAdmitted() {
            return undefined;
        },
        async install() {
            record('install');
        },
        async prepare() {
            record('prepare');
            if (scenario === 'prepare-error') {
                throw new Error('prepare failed');
            }
        },
        async finalize() {
            record('finalize');
            if (scenario === 'finalize-error') {
                throw new Error('finalize failed');
            }
        },
        async close(dispose) {
            record('close');
            const controller = new AbortController();
            await dispose(controller.signal);
        },
        snapshots() {
            return [];
        }
    };
}
type ManagedDisposalFixture = {
    readonly testCase: TestPlanCase;
    readonly record: ManagedResourceRecord;
    readonly stores: ManagedLifecycleStores;
    readonly calls: readonly string[];
};
export function managedDisposal(scenario: DisposalScenario, observed: boolean): ManagedDisposalFixture {
    const testCase = managedCase();
    const calls: string[] = [];
    const descriptor = defineResource({
        name: 'owner',
        scope: 'per-case',
        requirements: [],
        acquire() {
            return 'handle';
        },
        dispose() {
            calls.push('dispose');
            if (scenario === 'dispose-error') {
                throw new Error('dispose failed');
            }
        }
    });
    const stores = createManagedStores({
        testCases: [ testCase ],
        boundaryUseCounts: [],
        projectedResources: { resources: [] },
        timing: null
    });
    const record = {
        ...managedRecord(descriptor, testCase),
        checks: observed
            ? observation(function (event) {
                calls.push(event);
            }, scenario)
            : null,
        releaseOwner() {
            calls.push('release');
        }
    };
    const selected = {
        ...testCase,
        resourceAttachments: {
            ...testCase.resourceAttachments,
            directResources: [ { key: 'owner', resourceName: 'owner' } ],
            resourceGraph: [ {
                name: descriptor.name,
                scope: descriptor.scope,
                requirements: [],
                dependencies: [],
                scenarios: [],
                handleTransport: 'local' as const,
                workload: 'independent' as const
            } ]
        }
    };
    stores.rememberRecord(record.boundary.key, record);
    return { testCase: selected, record, stores, calls };
}
