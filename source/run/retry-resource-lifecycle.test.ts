import { createSuite, createTestCase, type TestScope, type RunResult } from '../packages/engine/engine.entry-point.ts';
import { defineResource, withResources, type ResourceDefinition } from '../packages/test/resources.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createResourceLifecycleRuntimePolicy } from './resource-lifecycle.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

type RetryResourceHandle = {
    readonly id: number;
    readonly disposed: boolean;
    readonly dispose: () => void;
};

type RetryResources = {
    readonly shared: ResourceDefinition<'shared', RetryResourceHandle, Readonly<Record<string, never>>>;
    readonly fresh: ResourceDefinition<'fresh', RetryResourceHandle, Readonly<Record<string, never>>>;
};

function retryResourceHandle(id: number, initiallyDisposed: boolean): RetryResourceHandle {
    let disposed = initiallyDisposed;
    return {
        id,
        get disposed() {
            return disposed;
        },
        dispose() {
            disposed = true;
        }
    };
}

function retryResources(recordEvent: (event: string) => void): RetryResources {
    let caseAcquisitions = 0;
    const shared = defineResource({
        name: 'shared',
        scope: 'per-suite',
        requirements: [],
        acquire() {
            recordEvent('shared acquired');
            return retryResourceHandle(0, false);
        },
        serializeHandle(handle) {
            return { id: handle.id, disposed: handle.disposed };
        },
        deserializeHandle(payload) {
            return retryResourceHandle(payload.id, payload.disposed);
        },
        dispose(handle) {
            handle.dispose();
            recordEvent('shared disposed');
        }
    });
    const fresh = defineResource({
        name: 'fresh',
        scope: 'per-case',
        requirements: [],
        acquire() {
            caseAcquisitions += 1;
            return retryResourceHandle(caseAcquisitions, false);
        },
        dispose(handle) {
            handle.dispose();
            recordEvent(`case ${handle.id} disposed`);
        }
    });
    return { shared, fresh };
}

function assertResourceLifecycle(
    scope: TestScope,
    result: RunResult,
    events: readonly string[]
): void {
    scope.assert.equal(result.summary.passed, 2);
    scope.assert.equal(result.runnerErrors.length, 0);
    scope.assert.deepEqual(events, [
        'shared acquired',
        'cleanup 1: disposed=false aborted=true',
        'case 1 disposed',
        'cleanup 2: disposed=false aborted=true',
        'case 2 disposed',
        'sibling',
        'shared disposed'
    ]);
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/run/retry-resource-lifecycle.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'per-case disposal failures prevent retries and preserve the body outcome',
            async body(scope: TestScope) {
                const engine = createTestEngine();
                let runs = 0;
                const fresh = defineResource({
                    name: 'fresh',
                    scope: 'per-case',
                    requirements: [],
                    acquire() {
                        return { id: 1 };
                    },
                    dispose() {
                        throw new Error('disposal failed');
                    }
                });
                const body = withResources({ fresh }, function (attemptScope) {
                    runs += 1;
                    attemptScope.assert.fail();
                    return attemptScope.assert.collect();
                });
                const plan = engine.createTestPlan(
                    engine.createRoot({
                        annotations: {},
                        controls: {},
                        title: 'disposal',
                        children: [ engine.createTestCase({ ...metadata, title: 'case', body }) ]
                    })
                );
                const result = await engine.execute(plan, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [],
                    retryPolicy: { maxAttempts: 3 },
                    runFacts: {},
                    startedAt: '1970-01-01T00:00:00.000Z',
                    runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null)
                });
                scope.assert.deepEqual([ runs, result.summary.runtimePolicy, result.runnerErrors.length ], [ 1, 1, 1 ]);
                scope.assert.equal(result.perTest[0]?.outcome, null);
                scope.assert.equal(result.perTest[0]?.attempts[0].outcome?.kind, 'fail');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'retry reacquires per-case resources without completing shared consumers',
            async body(scope: TestScope) {
                const engine = createTestEngine();
                const events: string[] = [];
                let runs = 0;
                const { shared, fresh } = retryResources(function recordEvent(event) {
                    events.push(event);
                });
                const body = withResources({ shared, fresh }, function (attemptScope) {
                    runs += 1;
                    const handle = attemptScope.resources.fresh;
                    attemptScope.cleanup(function () {
                        events.push(
                            `cleanup ${handle.id}: disposed=${handle.disposed} aborted=${attemptScope.signal.aborted}`
                        );
                    });
                    attemptScope.assert.false(attemptScope.resources.shared.disposed);
                    attemptScope.assert.equal(runs, 2);
                    return attemptScope.assert.collect();
                });
                const sibling = withResources({ shared }, function (attemptScope) {
                    events.push('sibling');
                    attemptScope.assert.false(attemptScope.resources.shared.disposed);
                    return attemptScope.assert.collect();
                });
                const plan = engine.createTestPlan(
                    engine.createRoot({
                        annotations: {},
                        controls: {},
                        title: 'root',
                        children: [
                            engine.createTestCase({ ...metadata, title: 'retry', body }),
                            engine.createTestCase({ ...metadata, title: 'sibling', body: sibling })
                        ]
                    })
                );
                const result = await engine.execute(plan, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [],
                    retryPolicy: { maxAttempts: 3 },
                    runFacts: {},
                    startedAt: '1970-01-01T00:00:00.000Z',
                    runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null)
                });
                assertResourceLifecycle(scope, result, events);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
