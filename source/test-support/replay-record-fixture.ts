import { currentRunRecordVersion } from '../run/run-record-format.ts';
import { recordedReplayProfile } from '../run/run-record-input.ts';
import type { ReplayRunRecord } from '../run/replay-record-types.ts';
import { workerPoolExecutionFacts, type WorkerPoolRunRuntime } from '../run/worker-pool-runtime.ts';
import { withReplay } from '../run/replay-context.ts';
import { collectedRunCaseEntries } from '../run/collected-run-plan.ts';
import { defaultIntegrationProfile } from './run-command-factory.ts';

export function workerReplayRecord(
    runtime: WorkerPoolRunRuntime,
    placementTrace: ReplayRunRecord['placementTrace']
): ReplayRunRecord {
    const run = runtime.resolvedRun;
    const identities = collectedRunCaseEntries(runtime.collectedPlan).map(function identity(entry) {
        return entry.workId;
    });
    return {
        version: currentRunRecordVersion,
        kind: 'single',
        id: 'retained-worker-run',
        status: 'interrupted',
        seed: run.facts.reproducibility.seed,
        request: { ...run.request, seed: { value: run.facts.reproducibility.seed } },
        loader: run.config.loader,
        engine: { kind: 'default' },
        replayPlan: runtime.collectedPlan,
        replayProfile: recordedReplayProfile(
            defaultIntegrationProfile({ execution: { processModel: 'worker-pool', scheduling: 'serial' } })
        ),
        replayWitness: null,
        identities,
        facts: {
            ...run.facts,
            execution: workerPoolExecutionFacts(run),
            cases: identities.map(function selected(workId) {
                return { workId, fileSet: null };
            })
        },
        placementTrace,
        result: null,
        versions: { node: process.versions.node, packages: {} }
    };
}

export async function withRecordedWorkerTrace<Value>(
    runtime: WorkerPoolRunRuntime,
    trace: ReplayRunRecord['placementTrace'],
    execute: () => Promise<Value>
): Promise<Value> {
    return await withReplay({ kind: 'record', record: workerReplayRecord(runtime, trace) }, null, execute);
}
