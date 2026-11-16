import { createClock, type Clock } from '@enormora/clock';
import type { RuntimeExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunProcessUsageTracker } from './run-engine-primitives.ts';
import { createNodeProcessUsageTracker } from './process-usage.ts';
import { createHostExecutionDriver, type HostExecutionInput } from './host-family-execution.ts';
import { snapshotRuntimePolicy } from './snapshot-runtime.ts';
import { withReplayWire, wirePropertyCorpus } from './replay-wire.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import { silentOutputSinks } from './worker-pool-output.ts';

export async function createWorkerExecute(
    command: WorkerPoolCommand,
    wallClock: Clock,
    sourcePlan: HostExecutionInput['sourcePlan']
): Promise<RuntimeExecute> {
    const execute = await createHostExecutionDriver({
        command,
        processModel: command.hostProcess.kind === 'child' ? 'hosted-worker' : 'direct',
        sourcePlan,
        wallClock,
        reporterDispatcher: createReporterDispatcher({ ...silentOutputSinks, wallClock })
    });
    return async function executeInReplayContext(plan, options) {
        if (options === undefined) {
            return await execute(plan);
        }
        return await withReplayWire(command.replay, async function executeAssignment() {
            return await execute(plan, {
                ...options,
                runtimePolicy: snapshotRuntimePolicy(options.runtimePolicy ?? null, command.snapshots),
                propertyRun: {
                    corpus: wirePropertyCorpus(command.replay),
                    seed: BigInt(command.seed),
                    projectRoot: command.cwd
                }
            });
        });
    };
}

export function createWorkerProcessUsageTracker(command: WorkerPoolCommand): RunProcessUsageTracker {
    return createNodeProcessUsageTracker(createClock(), {
        samplingIntervalMilliseconds: command.processUsageSamplingIntervalMilliseconds
    });
}
