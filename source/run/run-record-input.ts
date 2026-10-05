import type { RunRecord, RunRecordVersions } from './run-record-types.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { runEngineFacts } from './run-support.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export type RunRecordDependencies = {
    readonly createId: () => string;
    readonly node: RunOrchestratorDependencies['node'];
    readonly store: Pick<RunOrchestratorDependencies['runtimeStateStore'], 'write'>;
    readonly versions: RunRecordVersions;
    readonly wallClock: RunOrchestratorDependencies['wallClock'];
};

export function initialRecord(
    cwd: string,
    input: ResolvedRunInput,
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
