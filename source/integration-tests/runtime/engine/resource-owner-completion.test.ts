import { AsyncResource } from 'node:async_hooks';
import { table, suite, test, type TestScope } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import {
    type RunResult,
    createRoot,
    createTestPlan,
    createTestCase
} from '../../../packages/engine/engine.entry-point.ts';

import { defineResource, withResource, withResourceChecks } from '../../../packages/test/resources.entry-point.ts';
import { createResourceLifecycleRuntimePolicy } from '../../../run/resource-lifecycle.ts';
import { withRunnerInfrastructure } from '../../../execution-ownership.ts';
import { createExecute } from '../../../engine/execution.ts';
import { createReporterDispatcher } from '../../../engine/reporter-dispatcher.ts';

function ignoreOutput(): void {
    return undefined;
}

type ResourceFixtureMode = 'clean' | 'leak' | 'observer' | 'retain' | 'uncertain-body' | 'uncertain-cleanup';

async function executeOwnedFixture(disposal: ResourceFixtureMode, cleanup: TestScope['cleanup']): Promise<RunResult> {
    const activeResources: string[] = [];
    const allocations: AsyncResource[] = [];
    cleanup(function destroyInfrastructureAllocations() {
        for (const allocation of allocations) {
            allocation.emitDestroy();
        }
    });
    function recordUncertainResource(): void {
        allocations.push(withRunnerInfrastructure(function allocateInfrastructure() {
            return new AsyncResource('OpaqueWrap');
        }));
        activeResources.push('OpaqueWrap');
    }
    const fixture = defineResource({
        name: 'registry',
        scope: 'per-run',
        requirements: [],
        acquire() {
            activeResources.push('server');
            return 'registry';
        },
        dispose() {
            if (disposal !== 'retain') {
                activeResources.length = 0;
            }
            if (disposal === 'leak') {
                activeResources.push('leaked socket');
            } else if (disposal === 'uncertain-cleanup') {
                recordUncertainResource();
            }
        },
        serializeHandle(handle) {
            return handle;
        },
        deserializeHandle(handle: string) {
            return handle;
        }
    });

    const child = createTestCase({
        title: 'case',
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        body: withResource(
            disposal === 'observer'
                ? withResourceChecks(fixture, function (context) {
                    activeResources.push('listener');
                    context.cleanup.defer(function cleanupObservation() {
                        activeResources.length = 0;
                    });
                    return {
                        prepare() {
                            return undefined;
                        },
                        finalize() {
                            return { kind: 'complete' };
                        }
                    };
                })
                : fixture,
            function (scope) {
                if (disposal === 'uncertain-body') {
                    recordUncertainResource();
                }
                scope.assert.equal(scope.resources.registry, 'registry');
                return scope.assert.collect();
            }
        )
    });
    const plan = createTestPlan(createRoot({ title: 'root', annotations: {}, controls: {}, children: [ child ] }));
    const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const execute = createExecute({
        benchmarkEnvironment: null,
        wallClock,
        asyncLeakDiagnostics: disposal.startsWith('uncertain') ? 'enabled' : 'disabled',
        readActiveResourceTypes() {
            return activeResources;
        },
        reporterDispatcher: createReporterDispatcher({
            wallClock,
            stderr: { writeLine: ignoreOutput },
            stdout: { writeLine: ignoreOutput }
        })
    });
    return await execute(plan, {
        debug: { mode: 'off' },
        execution: { mode: 'serial-in-process' },
        reporters: [],
        retryPolicy: null,
        runFacts: {},
        startedAt: '1970-01-01T00:00:00.000Z',
        runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null)
    });
}

export const testNode = suite('resource owner completion', [
    test('keeps shared observer infrastructure with its resource owner', async function (scope) {
        const result = await executeOwnedFixture('observer', scope.cleanup);
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    table({
        title: 'uncertain resource growth fails the run without changing case verdicts',
        cases: [ 'uncertain-body', 'uncertain-cleanup' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const result = await executeOwnedFixture(mode, scope.cleanup);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.perTest[0]?.verdict, 'pass');
            scope.assert.partialDeepEqual(result.runnerErrors, [ {
                attributedTo: null,
                attributedToWork: null,
                attributedToAttempt: null,
                subtype: 'runtime-policy',
                cause: { capability: 'async-leak', phase: 'run', resourceTypes: [ 'OpaqueWrap' ] }
            } ]);
            return scope.assert.collect();
        }
    }),
    test('permits shared native handles until successful disposal', async function (scope) {
        const result = await executeOwnedFixture('clean', scope.cleanup);
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('reports shared native handles left alive after disposal', async function (scope) {
        const result = await executeOwnedFixture('retain', scope.cleanup);
        scope.assert.equal(result.status, 'failed');
        scope.assert.partialDeepEqual(result.runnerErrors, [ {
            subtype: 'runtime-policy',
            cause: { capability: 'async-leak', resourceTypes: [ 'server' ] }
        } ]);
        return scope.assert.collect();
    }),
    test(
        'attributes resources leaked during logical completion to the completed attempt',
        async function (scope) {
            const result = await executeOwnedFixture('leak', scope.cleanup);
            const completed = result.perTest[0];
            if (completed === undefined) {
                throw new Error('Missing completed resource case.');
            }
            scope.assert.partialDeepEqual(result.runnerErrors, [ {
                attributedTo: completed.id,
                attributedToWork: completed.workId,
                attributedToAttempt: { index: 0 },
                subtype: 'runtime-policy',
                cause: { capability: 'async-leak', resourceTypes: [ 'leaked socket' ] }
            } ]);
            return scope.assert.collect();
        }
    )
]);
