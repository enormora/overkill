import { fork } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCurrentProcessRunOrchestrator } from './current-process-run-orchestrator.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import {
    loadRunEngineModule,
    loadRunTestModules,
    runFileSystem,
    runDiscovery
} from './node-run-dependencies.entry-point.ts';
import {
    createSupervisedChildProcessStarter,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import {
    childProcessEntryPointUrl
} from './child-process.entry-point.ts';
import {
    createWorkerPoolHostProcessStarter
} from './worker-pool-host-process.ts';

const childProcessEntryPoint = fileURLToPath(childProcessEntryPointUrl);
const childPackageRoot = dirname(dirname(childProcessEntryPoint));

type ChildForkOptions = {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly execArgv: readonly string[];
    readonly stdio: readonly ['ignore', 'pipe', 'pipe', 'ipc'];
};

function forkSupervisedChildProcess(
    modulePath: string,
    childArguments: readonly string[],
    options: ChildForkOptions
): SupervisedChildProcess {
    const child = fork(modulePath, Array.from(childArguments), {
        cwd: options.cwd,
        env: options.env,
        execArgv: Array.from(options.execArgv),
        stdio: Array.from(options.stdio)
    });

    return {
        get exitCode() {
            return child.exitCode;
        },
        kill(signal) {
            return child.kill(signal);
        },
        on(...registration) {
            const [ event, listener ] = registration;

            if (event === 'error') {
                return child.on(event, listener);
            }

            if (event === 'exit') {
                return child.on(event, listener);
            }

            return child.on(event, listener);
        },
        get pid() {
            return child.pid;
        },
        send(message: Parameters<typeof child.send>[0]) {
            return child.send(message);
        },
        get signalCode() {
            return child.signalCode;
        },
        stderr: child.stderr,
        stdout: child.stdout
    };
}

export const startSupervisedChild = createSupervisedChildProcessStarter({
    childPackageRoot,
    childProcessEntryPoint,
    fork: forkSupervisedChildProcess,
    realpath: runFileSystem.realpath
});

export const startWorkerPoolHost = createWorkerPoolHostProcessStarter({
    childProcessEntryPoint,
    fork: forkSupervisedChildProcess
});

export const orchestrator = createCurrentProcessRunOrchestrator(defaultRunEngine, {
    discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
    loadRunEngineModule,
    loadRunTestModules,
    startSupervisedChild,
    startWorkerPoolHost
});
