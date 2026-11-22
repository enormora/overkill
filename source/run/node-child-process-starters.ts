import { fork } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageMetadata } from '../package-version.ts';
import { currentExecutionSession } from './execution-session-context.ts';
import {
    childProcessEntryPointUrl
} from './child-process.entry-point.ts';
import {
    runFileSystem
} from './node-run-dependencies.entry-point.ts';
import {
    createSupervisedChildProcessStarter,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import {
    createWorkerPoolHostProcessStarter
} from './worker-pool-host-process-starter.ts';

import { analysisOwnerPipe, signalAnalysisGroup } from './supervised-process-group.ts';

const childProcessEntryPoint = fileURLToPath(childProcessEntryPointUrl);
const childPackage = await packageMetadata(childProcessEntryPointUrl);
const childPackageRoot = childPackage?.directory ?? dirname(dirname(childProcessEntryPoint));

type ChildForkOptions = {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly execArgv: readonly string[];
    readonly stdio: readonly ['ignore', 'pipe', 'pipe', 'ipc'];
    readonly detached?: boolean;
};

function forkSupervisedChildProcess(
    modulePath: string,
    childArguments: readonly string[],
    options: ChildForkOptions
): SupervisedChildProcess {
    const ownsGroup = options.detached === true;
    const child = fork(modulePath, Array.from(childArguments), {
        cwd: options.cwd,
        env: options.env,
        execArgv: Array.from(options.execArgv),
        serialization: currentExecutionSession() === null ? 'json' : 'advanced',
        detached: ownsGroup,
        stdio: ownsGroup ? [ ...options.stdio, 'pipe' ] : Array.from(options.stdio)
    });

    let groupClosed = false;
    let groupTerminated = false;
    child.once('close', function releaseGroup() {
        groupClosed = true;
    });
    child.once('exit', function releaseOwnerPipe() {
        child.stdio[analysisOwnerPipe]?.destroy();
    });
    function terminateOwnedGroup(): boolean {
        if (groupClosed || groupTerminated || child.pid === undefined) {
            return false;
        }
        groupTerminated = signalAnalysisGroup(child.pid);
        return groupTerminated;
    }

    return {
        ...ownsGroup ? { ownsProcessGroup: true } as const : {},
        closeTransport() {
            child.stdio[analysisOwnerPipe]?.destroy();
            child.stdout?.destroy();
            child.stderr?.destroy();
            if (child.connected) {
                child.disconnect();
            }
            child.unref();
        },
        get exitCode() {
            return child.exitCode;
        },
        kill(signal) {
            if (ownsGroup) {
                return terminateOwnedGroup();
            }
            return child.exitCode === null && child.signalCode === null && child.kill(signal);
        },
        on(...registration) {
            const [ event, listener ] = registration;

            if (event === 'error') {
                return child.on(event, listener);
            }

            if (event === 'message') {
                return child.on(event, listener);
            }

            return child.on(event, listener);
        },
        get pid() {
            return child.pid;
        },
        send(message) {
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
