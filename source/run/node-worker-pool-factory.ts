import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolHostProcessStarter
} from './run-orchestrator-dependencies.ts';
import { createHostedWorkerPool } from './worker-pool-host-process.ts';
import { createPool } from './worker-pool-runtime.ts';

export function createWorkerPoolWithHostProcess(
    options: WorkerPoolCreationOptions,
    environmentVariables: RuntimeCapabilityPolicyEnvironment,
    startWorkerPoolHost: WorkerPoolHostProcessStarter
): CreatedWorkerPool {
    if (options.hostProcess.kind === 'direct') {
        return createPool(options);
    }

    return createHostedWorkerPool({
        environmentVariables,
        options,
        startWorkerPoolHost
    });
}
