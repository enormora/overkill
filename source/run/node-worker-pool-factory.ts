import type { Clock } from '@enormora/clock';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy-snapshots.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolHostProcessStarter
} from './run-orchestrator-dependencies.ts';
import { createHostedWorkerPool } from './worker-pool-host-process.ts';
import { createPool } from './worker-pool-creation.ts';

export function createWorkerPoolWithHostProcess(
    options: WorkerPoolCreationOptions,
    environmentVariables: RuntimeCapabilityPolicyEnvironment,
    startWorkerPoolHost: WorkerPoolHostProcessStarter,
    wallClock: Clock
): CreatedWorkerPool {
    if (options.hostProcess.kind === 'direct') {
        return createPool(options);
    }

    return createHostedWorkerPool({
        wallClock,
        environmentVariables,
        options,
        startWorkerPoolHost
    });
}
