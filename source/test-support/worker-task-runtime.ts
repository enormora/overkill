import { EventEmitter } from 'node:events';
import { createDeterministicClock } from '@enormora/clock';
import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import type {
    WorkerPoolCommand,
    WorkerRunTask,
    WorkerTaskPort,
    WorkerPoolMessage
} from '../run/worker-pool-protocol.ts';
import type { WorkerTaskRuntime } from '../run/worker-pool-worker.ts';
import type { RuntimeExecute } from '../engine/execution.ts';
import { createTestEngine } from './create-test-engine.ts';
import { runResultFactory } from './run-result-factory.ts';

function workerCommand(): WorkerPoolCommand {
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
        definitionLocationCapture: 'disabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 1000,
        maxConcurrency: 5,
        hostProcess: { kind: 'direct' },
        paths: [],
        processBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        processUsageSamplingIntervalMilliseconds: 1,
        root: { annotations: {}, controls: {}, title: '/project' },
        scheduling: 'serial',
        testFamily: 'microtest',
        timeoutMilliseconds: 1000,
        workerLifecycle: 'fresh-worker-per-unit'
    };
}

type WorkerTaskFixture = {
    readonly task: WorkerRunTask;
    readonly runtime: WorkerTaskRuntime;
    readonly events: readonly string[];
    readonly messages: readonly WorkerPoolMessage[];
    readonly executions: readonly Parameters<RuntimeExecute>[];
};
export function workerTaskRuntime(collectionFailure: Error | null, executionFailure: Error | null): WorkerTaskFixture {
    const events: string[] = [];
    const messages: WorkerPoolMessage[] = [];
    const executions: Parameters<RuntimeExecute>[] = [];
    const emitter = new EventEmitter();
    const port: WorkerTaskPort = {
        postMessage(message: WorkerPoolMessage) {
            messages.push(message);
        },
        close() {
            events.push('close');
        },
        on: emitter.on.bind(emitter),
        off: emitter.off.bind(emitter),
        once: emitter.once.bind(emitter)
    };
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        title: 'worker',
        annotations: {},
        controls: {},
        children: [
            engine.createTestCase({
                title: 'first',
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                body(scope) {
                    scope.assert.equal(1, 1);
                    return scope.assert.collect();
                }
            })
        ]
    }));
    const work = plan.cases[0].workId;
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    return {
        events,
        messages,
        executions,
        task: {
            kind: 'run',
            command: workerCommand(),
            port,
            lifecycle: { endpoint: null, token: 'worker-policy' },
            lane: 'lane',
            assignedWork: [ work ],
            assignedUnits: [ {
                attempt: 'attempt-1',
                traceUnit: { familyVariant: null, key: 'test.ts', mode: 'case', runtimes: [], workload: null },
                work: [ work ]
            } ],
            boundaryUseCounts: [],
            projectedResources: { resources: [] },
            runWork: [ work ],
            startedAtMilliseconds: 0,
            workloadInputs: []
        },
        runtime: {
            clock() {
                return clock;
            },
            async collect() {
                events.push('collect');
                if (collectionFailure !== null) {
                    throw collectionFailure;
                }
                return { runnerErrors: [], testPlan: plan };
            },
            async execute() {
                events.push('prepare-execution');
                return async function execute(...args) {
                    executions.push(args);
                    if (executionFailure !== null) {
                        throw executionFailure;
                    }
                    clock.advanceByMilliseconds(1);
                    return runResultFactory.build({
                        summary: { planned: 1, passed: 1 },
                        status: 'passed',
                        planStatus: 'planned'
                    });
                };
            },
            capture() {
                events.push('capture');
                return {
                    restore() {
                        events.push('restore-capture');
                    }
                };
            },
            suppress() {
                events.push('suppress');
                return {
                    restore() {
                        events.push('restore-suppression');
                    }
                };
            }
        }
    };
}
