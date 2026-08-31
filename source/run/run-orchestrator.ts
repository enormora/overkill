import { randomBytes } from 'node:crypto';
import { createWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import type { Engine } from '../engine/engine.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { createRunOrchestrator } from './run.ts';
import type { RunOrchestrator, RunOrchestratorDependencies } from './run-types.ts';

const seedByteLength = 8;

function createDefaultSeed(): bigint {
    return randomBytes(seedByteLength).readBigUInt64BE();
}

type RuntimeCapabilityPolicyInput = RunOrchestratorDependencies['runtimeCapabilityPolicy'];

type NodeRunOrchestratorInput = {
    readonly defaultEngine: Engine;
    readonly installIpcRestriction: RuntimeCapabilityPolicyInput['installIpcRestriction'];
    readonly installProcessExecutionRestriction: RuntimeCapabilityPolicyInput['installProcessExecutionRestriction'];
    readonly node: RunOrchestratorDependencies['node'];
    readonly readEnvironment: RuntimeCapabilityPolicyInput['readEnvironment'];
    readonly readStorage: RuntimeCapabilityPolicyInput['readStorage'];
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
        defaultEngine: input.defaultEngine,
        execute: createExecute({
            reporterDispatcher,
            wallClock
        }),
        node: input.node,
        reporterDispatcher,
        runtimeCapabilityPolicy: {
            installIpcRestriction: input.installIpcRestriction,
            installProcessExecutionRestriction: input.installProcessExecutionRestriction,
            readEnvironment: input.readEnvironment,
            readStorage: input.readStorage
        },
        wallClock
    });
}
