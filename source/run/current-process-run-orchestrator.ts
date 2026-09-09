import type { Engine } from '../engine/engine.ts';
import {
    installIpcRestriction as installProcessIpcRestriction,
    installProcessExecutionRestriction as installNodeProcessExecutionRestriction
} from './node-process-capability-restrictions.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import { createNodeRunOrchestrator } from './run-orchestrator.ts';
import type { RunOrchestrator } from './run-types.ts';

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

export function createCurrentProcessRunOrchestrator(defaultEngine: Engine): RunOrchestrator {
    return createNodeRunOrchestrator({
        defaultEngine,
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
