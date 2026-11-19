import { defineResource } from '../resources/resources.ts';
import { createResourceLifecycleSession, type ResourceLifecycleSession } from '../run/resource-lifecycle.ts';
import { acquireComposedResources } from '../packages/test/resource-wrapper-session.ts';
import { boundaryFor } from '../run/resource-lifecycle-boundaries.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { managedCase } from './managed-resource-acquisition.ts';

type ProjectedLifecycleFixture = {
    readonly session: ResourceLifecycleSession;
    readonly testCase: TestPlanCase;
    readonly boundary: string;
    readonly use: (signal: AbortSignal) => Promise<unknown>;
};
export function projectedResourceLifecycle(): ProjectedLifecycleFixture {
    const testCase = managedCase();
    const resource = defineResource({
        name: 'projected-owner',
        scope: 'per-run',
        requirements: [],
        acquire() {
            throw new Error('Consumers must not acquire an external owner.');
        },
        dispose: null,
        serializeHandle() {
            throw new Error('Consumers must not publish the external owner handle.');
        },
        deserializeHandle(payload: unknown) {
            if (typeof payload !== 'string') {
                throw new TypeError('Expected a string projection.');
            }
            return `consumer:${payload}`;
        }
    });
    const boundary = boundaryFor(resource, testCase).key;
    const session = createResourceLifecycleSession({
        testCases: [ testCase ],
        boundaryUseCounts: [],
        caseDisposalScopes: new Set(),
        projectedResources: { resources: [ { boundaryKey: boundary, payload: 'initial' } ] },
        timing: null
    });
    return {
        session,
        testCase,
        boundary,
        async use(signal) {
            return await session.runtimePolicy.runAttempt(testCase, { index: 0 }, async function () {
                const composed = await acquireComposedResources(
                    [ { kind: 'resources', resources: { owner: resource } } ],
                    signal,
                    { acquisitionFailure: 'Acquire failed.', disposalFailure: 'Dispose failed.' }
                );
                return composed.directResources.owner;
            });
        }
    };
}
