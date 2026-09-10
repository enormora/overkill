import type { Engine } from '../engine/engine.ts';
import {
    installIpcRestriction as installProcessIpcRestriction,
    installProcessExecutionRestriction as installNodeProcessExecutionRestriction
} from './node-process-capability-restrictions.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import {
    createNodeRunOrchestrator,
    type NodeRunOrchestratorInput
} from './run-orchestrator.ts';
import type { RunOrchestrator } from './run-types.ts';

export type CurrentProcessRunOrchestratorDependencies = {
    readonly discoverRunFilesWithProjectRoot: NodeRunOrchestratorInput['discoverRunFilesWithProjectRoot'];
    readonly loadRunEngineModule: NodeRunOrchestratorInput['loadRunEngineModule'];
    readonly loadRunTestModules: NodeRunOrchestratorInput['loadRunTestModules'];
    readonly startSupervisedChild: NodeRunOrchestratorInput['startSupervisedChild'];
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

export function createCurrentProcessRunOrchestrator(
    defaultEngine: Engine,
    dependencies: CurrentProcessRunOrchestratorDependencies
): RunOrchestrator {
    return createNodeRunOrchestrator({
        defaultEngine,
        discoverRunFilesWithProjectRoot: dependencies.discoverRunFilesWithProjectRoot,
        loadRunEngineModule: dependencies.loadRunEngineModule,
        loadRunTestModules: dependencies.loadRunTestModules,
        startSupervisedChild: dependencies.startSupervisedChild,
        installIpcRestriction(record) {
            return installProcessIpcRestriction(process, record);
        },
        installProcessExecutionRestriction(record) {
            return installNodeProcessExecutionRestriction(process, record);
        },
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
    });
}
