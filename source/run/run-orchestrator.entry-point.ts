import { createNodeRunOrchestrator } from './run-orchestrator.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

export const orchestrator = createNodeRunOrchestrator({
    node: {
        arch: process.arch,
        platform: process.platform,
        version: process.versions.node
    },
    readEnvironment() {
        return readProcessEnvironment(process);
    },
    readStartedAt() {
        const startedAt = new Date();

        return startedAt.toISOString();
    },
    readStorage(name) {
        return readWebStorage(globalThis, name);
    },
    stderr: { writeLine: writeStderrLine },
    stdout: { writeLine: writeStdoutLine }
});
