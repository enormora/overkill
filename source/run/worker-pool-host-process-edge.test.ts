import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createHostedWorkerPool } from './worker-pool-host-process.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-host-process-edge.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createHostedWorkerPool() rejects invalid tasks',
            async body(scope: OverkillScope) {
                const controller = new AbortController();
                const pool = createHostedWorkerPool({
                    environmentVariables: {},
                    options: {
                        cwd: '/project',
                        hostProcess: { kind: 'direct' },
                        testFamily: 'integration',
                        workerCount: 1,
                        workerLifecycle: 'reuse'
                    },
                    startWorkerPoolHost() {
                        throw new Error('Host should not start for invalid tasks.');
                    }
                });

                await scope.assert.rejects(async function runInvalidTask() {
                    await pool.run({}, {
                        name: 'invalid',
                        signal: controller.signal,
                        transferList: []
                    });
                }, { message: 'Hosted worker-pool received an invalid task.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
