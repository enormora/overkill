import type { Clock } from '@enormora/clock';
import { createExecute, type Execute } from '../engine/execution.ts';
import type { BenchmarkExecutionEnvironment } from '../engine/benchmark-garbage-collection.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import { silentOutputSinks } from './worker-pool-output.ts';

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

export async function createWorkerExecute(command: WorkerPoolCommand, wallClock: Clock): Promise<Execute> {
    let benchmarkEnvironment: BenchmarkExecutionEnvironment | null = null;
    if (command.testFamily === 'benchmark') {
        const { createBenchmarkExecutionEnvironment } = await import('./benchmark-execution-environment.ts');
        benchmarkEnvironment = createBenchmarkExecutionEnvironment(
            command.benchmarkGarbageCollection,
            command.hostProcess.kind === 'child' ? 'hosted-worker' : 'direct'
        );
    }
    return createExecute({
        benchmarkEnvironment,
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes,
        wallClock,
        reporterDispatcher: createReporterDispatcher({ ...silentOutputSinks, wallClock })
    });
}
