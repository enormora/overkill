import type { Clock } from '@enormora/clock';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { createExecute, type RuntimeExecute } from '../engine/execution.ts';
import type { BenchmarkExecutionEnvironment } from '../engine/benchmark-environment.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { snapshotRuntimePolicy } from './snapshot-runtime.ts';
import { withReplayWire, wirePropertyCorpus } from './replay-wire.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import { silentOutputSinks } from './worker-pool-output.ts';

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

export async function createWorkerExecute(command: WorkerPoolCommand, wallClock: Clock): Promise<RuntimeExecute> {
    let benchmarkEnvironment: BenchmarkExecutionEnvironment | null = null;
    if (command.testFamily === 'benchmark') {
        const { createBenchmarkExecutionEnvironment } = await import('./benchmark-execution-environment.ts');
        benchmarkEnvironment = createBenchmarkExecutionEnvironment(
            command.benchmarkGarbageCollection,
            command.hostProcess.kind === 'child' ? 'hosted-worker' : 'direct',
            command.benchmarkNormalization
        );
    }
    const execute = createExecute({
        benchmarkEnvironment,
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes,
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
                outputRenderer: createPlainOutputRenderer(),
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
