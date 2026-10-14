import type { Engine } from '../engine/engine.ts';
import {
    observeProcessIpcListeners,
    observeProcessExit as observeNodeProcessExit
} from './node-process-policy-observation.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import type { NodeRunOrchestratorInput } from './node-run-orchestrator-dependencies.ts';

export type CurrentProcessRunOrchestratorDependencies = {
    readonly discoverRunFilesWithProjectRoot: NodeRunOrchestratorInput['discoverRunFilesWithProjectRoot'];
    readonly loadRunEngineModule: NodeRunOrchestratorInput['loadRunEngineModule'];
    readonly loadRunTestModules: NodeRunOrchestratorInput['loadRunTestModules'];
    readonly startSupervisedChild: NodeRunOrchestratorInput['startSupervisedChild'];
    readonly startWorkerPoolHost: NodeRunOrchestratorInput['startWorkerPoolHost'];
};

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

function writeStdout(chunk: Uint8Array): void {
    process.stdout.write(chunk);
}

function writeStderr(chunk: Uint8Array): void {
    process.stderr.write(chunk);
}

export function createCurrentProcessRunInput(
    defaultEngine: Engine,
    dependencies: CurrentProcessRunOrchestratorDependencies
): NodeRunOrchestratorInput {
    return {
        defaultEngine,
        discoverRunFilesWithProjectRoot: dependencies.discoverRunFilesWithProjectRoot,
        loadRunEngineModule: dependencies.loadRunEngineModule,
        loadRunTestModules: dependencies.loadRunTestModules,
        startSupervisedChild: dependencies.startSupervisedChild,
        startWorkerPoolHost: dependencies.startWorkerPoolHost,
        observeIpcListeners(record) {
            return observeProcessIpcListeners(process, record, new WeakSet());
        },
        observeProcessExit: observeNodeProcessExit,
        node: {
            arch: process.arch,
            platform: process.platform,
            version: process.versions.node
        },
        readEnvironment() {
            return readProcessEnvironment(process);
        },
        readStorage(name) {
            return readWebStorage(globalThis, name);
        },
        stderr: { write: writeStderr, writeLine: writeStderrLine },
        stdout: { write: writeStdout, writeLine: writeStdoutLine }
    };
}
