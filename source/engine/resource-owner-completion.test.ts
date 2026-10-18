import { createDeterministicClock } from '@enormora/clock';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createRoot, createTestPlan, createTestCase, type RunResult } from '../packages/engine/engine.entry-point.ts';
import { defineResource, withResource } from '../packages/test/resources.entry-point.ts';
import { createResourceLifecycleRuntimePolicy } from '../run/resource-lifecycle.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';

function ignoreOutput(): void {
    return undefined;
}

async function executeOwnedFixture(cleanup: boolean): Promise<RunResult> {
    const activeResources: string[] = [];
    const fixture = defineResource({
        name: 'registry',
        scope: 'per-run',
        requirements: [],
        acquire() {
            activeResources.push('server');
            return 'registry';
        },
        dispose() {
            if (cleanup) {
                activeResources.length = 0;
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
        body: withResource(fixture, function (scope) {
            scope.assert.equal(scope.resources.registry, 'registry');
            return scope.assert.collect();
        })
    });
    const plan = createTestPlan(createRoot({ title: 'root', annotations: {}, controls: {}, children: [ child ] }));
    const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const execute = createExecute({
        benchmarkEnvironment: null,
        wallClock,
        asyncLeakDiagnostics: 'disabled',
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
        execution: { mode: 'serial-in-process' },
        reporters: [],
        retryPolicy: null,
        runFacts: {},
        startedAt: '1970-01-01T00:00:00.000Z',
        runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null)
    });
}

export const testNode = suite('resource owner completion', [
    test('permits shared native handles until successful disposal', async function (scope) {
        const result = await executeOwnedFixture(true);
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('reports shared native handles left alive after disposal', async function (scope) {
        const result = await executeOwnedFixture(false);
        scope.assert.equal(result.status, 'failed');
        scope.assert.partialDeepEqual(result.runnerErrors, [ {
            subtype: 'runtime-policy',
            cause: { capability: 'async-leak', resourceTypes: [ 'server' ] }
        } ]);
        return scope.assert.collect();
    })
]);
