import { createWallClock } from '@enormora/wall-clock';
import { createExecute } from '../engine/execution.ts';
import type { Engine } from '../engine/engine.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import { createRunOrchestrator } from './run.ts';
import { createRandomRunSeed } from './run-seed.ts';
import type { RunOrchestrator, RunOrchestratorDependencies } from './run-types.ts';

type RuntimeCapabilityPolicyInput = RunOrchestratorDependencies['runtimeCapabilityPolicy'];

type NodeRunOrchestratorInput = {
    readonly defaultEngine: Engine;
    readonly installIpcRestriction: RuntimeCapabilityPolicyInput['installIpcRestriction'];
    readonly installProcessExecutionRestriction: RuntimeCapabilityPolicyInput['installProcessExecutionRestriction'];
    readonly node: RunOrchestratorDependencies['node'];
    readonly readEnvironment: RuntimeCapabilityPolicyInput['readEnvironment'];
    readonly readStorage: RuntimeCapabilityPolicyInput['readStorage'];
    readonly stderr: {
        readonly write: (chunk: Uint8Array) => void;
        readonly writeLine: (line: string) => void;
    };
    readonly stdout: {
        readonly write: (chunk: Uint8Array) => void;
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
        createSeed: createRandomRunSeed,
        createResourceUsageTracker(options) {
            return createNodeResourceUsageTracker(wallClock, options);
        },
        defaultEngine: input.defaultEngine,
        execute: createExecute({
            reporterDispatcher,
            wallClock
        }),
        liveOutput: {
            stderr: { write: input.stderr.write },
            stdout: { write: input.stdout.write }
        },
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
