import { type TestNode, suite, test } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { createHostedWorkerPool } from './worker-pool-host-process.ts';

export const testNode: TestNode = suite('Worker pool host process edge', [
    test('createHostedWorkerPool() rejects invalid tasks', async function (scope) {
        const controller = new AbortController();
        const pool = createHostedWorkerPool({
            wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
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
    })
]);
