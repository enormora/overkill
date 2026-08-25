import { createNodeRunOrchestrator } from './run-orchestrator.ts';
import {
    installIpcRestriction as installProcessIpcRestriction,
    installProcessExecutionRestriction as installNodeProcessExecutionRestriction
} from './node-process-capability-restrictions.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

export const orchestrator = createNodeRunOrchestrator({
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
    stderr: { writeLine: writeStderrLine },
    stdout: { writeLine: writeStdoutLine }
});
