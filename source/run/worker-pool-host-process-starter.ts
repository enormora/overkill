import {
    childRoleArgument,
    workerPoolHostRole
} from './child-process-roles.ts';
import type {
    WorkerPoolHostProcessStartOptions,
    WorkerPoolHostProcessStarter
} from './run-orchestrator-dependencies.ts';
import {
    sanitizedChildEnvironment,
    type SupervisedChildProcess
} from './supervised-child-process.ts';

type WorkerPoolHostForkOptions = {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly execArgv: readonly string[];
    readonly stdio: readonly ['ignore', 'pipe', 'pipe', 'ipc'];
};

type WorkerPoolHostProcessStarterDependencies = {
    readonly childProcessEntryPoint: string;
    readonly fork: (
        modulePath: string,
        childArguments: readonly string[],
        options: WorkerPoolHostForkOptions
    ) => SupervisedChildProcess;
};

export function createWorkerPoolHostProcessStarter(
    dependencies: WorkerPoolHostProcessStarterDependencies
): WorkerPoolHostProcessStarter {
    return function startWorkerPoolHost(options: WorkerPoolHostProcessStartOptions) {
        return dependencies.fork(
            dependencies.childProcessEntryPoint,
            [ childRoleArgument(workerPoolHostRole) ],
            {
                cwd: options.cwd,
                env: sanitizedChildEnvironment(options.environmentVariables, options.testFamily),
                execArgv: Array.from(options.nodeArguments),
                stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
            }
        );
    };
}
