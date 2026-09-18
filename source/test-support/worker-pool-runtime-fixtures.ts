import { createDeterministicWallClock } from '@enormora/wall-clock';
import { defaultRunEngine } from '../run/default-run-engine.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies
} from '../run/run-orchestrator-dependencies.ts';
import type { WorkerPoolRunRuntime } from '../run/worker-pool-runtime.ts';

const fixtureSeed = 42n;

function testOnlyDependency(): never {
    throw new Error('Test fixture dependency is not configured.');
}

function doNothing(): void {
    return undefined;
}

function createFakePool(maxThreads: number, isolateWorkers: boolean): CreatedWorkerPool {
    return {
        async destroy() {
            return undefined;
        },
        options: { isolateWorkers, maxThreads },
        async run() {
            throw new Error('Fake worker pool did not receive a task implementation.');
        }
    };
}

const createFakeWorkerPool: RunOrchestratorDependencies['createWorkerPool'] = function createFakeWorkerPool(options) {
    return createFakePool(options.workerCount, options.workerLifecycle === 'fresh-worker-per-unit');
};

export function fakeWorkerPoolRuntimeDependencies(): WorkerPoolRunRuntime['dependencies'] {
    return {
        availableParallelism: 2,
        createResourceUsageTracker: testOnlyDependency,
        createSeed() {
            return fixtureSeed;
        },
        createWorkerPool: createFakeWorkerPool,
        defaultEngine: defaultRunEngine,
        durationHistoryStore: {
            async read() {
                return null;
            },
            async write() {
                return undefined;
            }
        },
        discoverRunFilesWithProjectRoot: testOnlyDependency,
        execute: defaultRunEngine.execute,
        liveOutput: {
            stderr: {
                write: doNothing
            },
            stdout: {
                write: doNothing
            }
        },
        loadRunEngineModule: testOnlyDependency,
        loadRunTestModules: testOnlyDependency,
        node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
        reporterDispatcher: {
            async createDelivery() {
                return {
                    async disposeReporters() {
                        return [];
                    },
                    async reportEvent() {
                        return [];
                    },
                    async reportResult() {
                        return [];
                    }
                };
            },
            async trackRunnerErrorDelivery(work) {
                return {
                    deliveredRunnerErrors: [],
                    result: await work(),
                    undeliveredRunnerErrors: []
                };
            }
        },
        runtimeCapabilityPolicy: {
            installIpcRestriction() {
                return doNothing;
            },
            installProcessExecutionRestriction() {
                return doNothing;
            },
            readEnvironment() {
                return {};
            },
            readStorage() {
                return null;
            }
        },
        startSupervisedChild: testOnlyDependency,
        startWorkerPoolHost: testOnlyDependency,
        wallClock: createDeterministicWallClock()
    };
}
