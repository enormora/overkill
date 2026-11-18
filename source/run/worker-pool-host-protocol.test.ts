import { execFile } from 'node:child_process';
import { runIfMain } from '#test-runner';
import {
    defaultFailureArtifactPolicy,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { childProcessEnvelope } from './child-process-protocol.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import { workerPoolHostCorrelationId } from './worker-pool-host-protocol.ts';

function workerPoolCommand(): WorkerPoolCommand {
    return {
        implementations: null,
        implementationContext: { projectRoot: '/project' },

        family: null,
        debug: { mode: 'off', selectors: [] },
        failureArtifacts: defaultFailureArtifactPolicy,
        capture: 'buffered',
        replay: null,
        snapshots: null,
        seed: '0',
        benchmarkNormalization: null,
        benchmarkGarbageCollection: null,
        propertyPolicy: null,
        attachmentEndpoint: null,
        retryPolicy: null,
        collectionTimeoutMilliseconds: 100,
        cwd: '/project',
        definitionLocationCapture: 'enabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 200,
        maxConcurrency: 5,
        hostProcess: { kind: 'child', nodeArguments: [ '--expose-gc' ] },
        paths: [ 'test.ts' ],
        processBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        processUsageSamplingIntervalMilliseconds: 10,
        root: { annotations: {}, controls: {}, title: process.cwd() },
        scheduling: 'serial',
        testFamily: 'integration',
        timeoutMilliseconds: 100,
        workerLifecycle: 'reuse'
    };
}

async function assertEntrypointDispatchesHostCommands(scope: OverkillScope): Promise<void> {
    const commands = [
        childProcessEnvelope('other', { kind: 'destroy' }),
        ...[
            { kind: 'run-task', task: { command: workerPoolCommand(), kind: 'collect' }, taskId: 'not-configured' },
            { kind: 'abort-task', taskId: 'not-configured' },
            { kind: 'start-process-usage-tracking', samplingIntervalMilliseconds: 1000 },
            { kind: 'finish-process-usage-tracking' },
            { kind: 'destroy' }
        ]
            .map(function envelope(command) {
                return childProcessEnvelope(workerPoolHostCorrelationId, command);
            })
    ];
    const entrypoint = new URL('./worker-pool-host.entry-point.ts', import.meta.url);
    const script = `
        import assert from 'node:assert/strict';
        await import(${JSON.stringify(entrypoint.href)});
        for (const command of ${JSON.stringify(commands)}) assert.equal(process.emit('message', command), true);
        await new Promise(resolve => setImmediate(resolve));
        process.stdout.write('host commands dispatched\\n');
    `;
    const output = await new Promise<string>(function runHostProbe(resolve, reject) {
        execFile(
            process.execPath,
            [ '--input-type=module', '--eval', script ],
            { timeout: 5000 },
            function (error, stdout) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error('Host command probe failed.', { cause: error }));
                }
            }
        );
    });
    scope.assert.equal(output, 'host commands dispatched\n');
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'worker host entrypoint integration',
    children: [ createOverkillTestCase({
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: 'worker-pool host entrypoint dispatches host commands',
        async body(scope: OverkillScope) {
            await assertEntrypointDispatchesHostCommands(scope);

            return scope.assert.collect();
        }
    }) ]
});
await runIfMain(import.meta, testNode);
