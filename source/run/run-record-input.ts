import path from 'node:path';
import { ulid } from 'ulid';
import { runRecordVersions } from './run-record-versions.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import type { RunRecord, RunRecordVersions } from './run-record-types.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { runEngineFacts } from './run-support.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export type RunRecordDependencies = {
    readonly history: HistoryStorage;
    readonly createId: () => string;
    readonly node: RunOrchestratorDependencies['node'];
    readonly store: Pick<RunOrchestratorDependencies['runtimeStateStore'], 'write'>;
    readonly versions: RunRecordVersions;
    readonly wallClock: RunOrchestratorDependencies['wallClock'];
};

export function initialRecord(
    cwd: string,
    input: Pick<ResolvedRunInput, 'config' | 'engine' | 'profile' | 'projectRoot' | 'request'>,
    dependencies: RunRecordDependencies
): RunRecord {
    if (input.request.seed.value === null) {
        throw new Error('Run recording requires a resolved seed.');
    }

    const seed = input.request.seed.value.toString();
    const startedAt = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);

    return {
        coverage: null,
        cwd,
        engine: runEngineFacts(input.engine),
        environment: {
            node: dependencies.node,
            projectRoot: input.projectRoot,
            runtimeStateDir: input.config.runtimeStateDir
        },
        execution: input.profile.execution,
        facts: null,
        id: dependencies.createId(),
        identities: [],
        kind: 'single',
        loader: input.config.loader,
        placementTrace: null,
        request: { ...input.request, seed: { value: seed } },
        result: null,
        runtime: null,
        seed,
        startedAt: startedAt.toISOString(),
        status: 'started',
        version: 1,
        versions: dependencies.versions
    };
}

export type RunRecordInput = Pick<ResolvedRunInput, 'config' | 'engine' | 'profile' | 'projectRoot' | 'request'>;
export type RunRecordExecutionDependencies = Pick<
    RunOrchestratorDependencies,
    'createHistoryStorage' | 'node' | 'runtimeStateStore' | 'wallClock'
>;

export async function createRunRecordDependencies(
    input: RunRecordInput,
    dependencies: RunRecordExecutionDependencies
): Promise<RunRecordDependencies> {
    return {
        history: dependencies.createHistoryStorage(
            path.resolve(input.projectRoot, input.config.runtimeStateDir),
            input.config.history
        ),
        createId: ulid,
        node: dependencies.node,
        store: dependencies.runtimeStateStore,
        versions: await runRecordVersions(input.engine, dependencies.node.version),
        wallClock: dependencies.wallClock
    };
}
