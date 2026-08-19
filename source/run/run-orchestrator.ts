import { randomBytes } from 'node:crypto';
import { createWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { createRunOrchestrator, type RunOrchestrator } from './run.ts';

const seedByteLength = 8;
const defaultWallClock = createWallClock();

function createDefaultSeed(): bigint {
    return randomBytes(seedByteLength).readBigUInt64BE();
}

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

export const orchestrator: RunOrchestrator = createRunOrchestrator({
    createSeed: createDefaultSeed,
    createResourceUsageTracker(options) {
        return createNodeResourceUsageTracker(defaultWallClock, options);
    },
    defaultEngine: defaultRunEngine,
    execute: createExecute({
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: writeStderrLine },
            stdout: { writeLine: writeStdoutLine },
            wallClock: defaultWallClock
        }),
        wallClock: defaultWallClock
    }),
    node: {
        arch: process.arch,
        platform: process.platform,
        version: process.versions.node
    },
    readStartedAt() {
        const startedAt = new Date(defaultWallClock.currentTimestampInMilliseconds);

        return startedAt.toISOString();
    }
});
