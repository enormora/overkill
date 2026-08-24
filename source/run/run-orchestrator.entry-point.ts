import { createNodeRunOrchestrator } from './run-orchestrator.ts';

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

function readWebStorage(name: 'localStorage' | 'sessionStorage') {
    if (name === 'localStorage') {
        return null;
    }

    const storage = (globalThis as Readonly<Record<string, unknown>>)[name];

    if (typeof storage !== 'object' || storage === null) {
        return null;
    }

    const candidate = storage as Readonly<Record<string, unknown>>;

    if (
        typeof candidate.length !== 'number' ||
        typeof candidate.getItem !== 'function' ||
        typeof candidate.key !== 'function'
    ) {
        return null;
    }

    return candidate as {
        readonly getItem: (key: string) => string | null;
        readonly key: (index: number) => string | null;
        readonly length: number;
    };
}

export const orchestrator = createNodeRunOrchestrator({
    node: {
        arch: process.arch,
        platform: process.platform,
        version: process.versions.node
    },
    readEnvironment() {
        return process.env;
    },
    readStartedAt() {
        return new Date().toISOString();
    },
    readStorage: readWebStorage,
    stderr: { writeLine: writeStderrLine },
    stdout: { writeLine: writeStdoutLine }
});
