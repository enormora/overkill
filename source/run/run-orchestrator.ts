import { randomBytes } from 'node:crypto';
import { createWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { createRunOrchestrator } from './run.ts';
import type { RunOrchestrator, RunOrchestratorDependencies } from './run-types.ts';

const seedByteLength = 8;

function createDefaultSeed(): bigint {
    return randomBytes(seedByteLength).readBigUInt64BE();
}

type NodeRunOrchestratorInput = {
    readonly node: RunOrchestratorDependencies['node'];
    readonly readEnvironment: RunOrchestratorDependencies['runtimeCapabilityPolicy']['readEnvironment'];
    readonly readStartedAt: RunOrchestratorDependencies['readStartedAt'];
    readonly readStorage: RunOrchestratorDependencies['runtimeCapabilityPolicy']['readStorage'];
    readonly stderr: {
        readonly writeLine: (line: string) => void;
    };
    readonly stdout: {
        readonly writeLine: (line: string) => void;
    };
};

export function createNodeRunOrchestrator(input: NodeRunOrchestratorInput): RunOrchestrator {
    const wallClock = createWallClock();
    const reporterDispatcher = createReporterDispatcher({
        stderr: input.stderr,
        stdout: input.stdout,
        wallClock
    });

    return createRunOrchestrator({
        createSeed: createDefaultSeed,
        createResourceUsageTracker(options) {
            return createNodeResourceUsageTracker(wallClock, options);
        },
        defaultEngine: defaultRunEngine,
        execute: createExecute({
            reporterDispatcher,
            wallClock
        }),
        node: input.node,
        reporterDispatcher,
        readStartedAt: input.readStartedAt,
        runtimeCapabilityPolicy: {
            readEnvironment: input.readEnvironment,
            readStorage: input.readStorage
        },
        wallClock
    });
}
