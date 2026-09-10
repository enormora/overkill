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
    supervisedChildProcessEntryPointUrl
} from './supervised-child-process.entry-point.ts';

const childProcessEntryPoint = fileURLToPath(supervisedChildProcessEntryPointUrl);
const childPackageRoot = dirname(dirname(childProcessEntryPoint));

export const startSupervisedChild = createSupervisedChildProcessStarter({
    childPackageRoot,
    childProcessEntryPoint,
    fork(modulePath, childArguments, options): SupervisedChildProcess {
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
            send(message) {
                return child.send(message);
            },
            get signalCode() {
                return child.signalCode;
            },
            stderr: child.stderr,
            stdout: child.stdout
        };
    },
    realpath: runFileSystem.realpath
});

export const orchestrator = createCurrentProcessRunOrchestrator(defaultRunEngine, {
    discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
    loadRunEngineModule,
    loadRunTestModules,
    startSupervisedChild
});
