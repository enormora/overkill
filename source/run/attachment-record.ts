import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { recordedRunPlan } from './recorded-run-plan.ts';
import {
    collectedRunPlanFromTestPlan,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import { createRunRecordDependencies } from './run-record-input.ts';
import { createStoredRunValue } from './supervised-run-state.ts';
import { createRunRecordSession, type RunRecordSession } from './run-record.ts';
import { selectProfile } from './test-profile.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRun } from './run-types.ts';

export type AttachmentRecord = {
    readonly captureTime: () => number;
    readonly session: RunRecordSession;
    readonly checkpoint: (artifacts: readonly RuntimeAttachmentArtifact[]) => Promise<void>;
};
type AttachmentRecordCheckpoint = {
    readonly checkpoint: (artifacts: readonly RuntimeAttachmentArtifact[]) => Promise<void>;
};
function createAttachmentRecordCheckpoint(
    record: RunRecordSession,
    resolved: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): AttachmentRecordCheckpoint {
    const pending = createStoredRunValue<Promise<void>>(Promise.resolve());
    const startedAt = Number(dependencies.wallClock.currentMonotonicMicroseconds);
    async function persist(artifacts: readonly RuntimeAttachmentArtifact[], previous: Promise<void>): Promise<void> {
        await previous;
        const plan = resolved.plan.kind === 'local'
            ? collectedRunPlanFromTestPlan(resolved.plan.testPlan)
            : resolved.plan.collectedPlan;
        const partial = createRunResultFromCollectedPlan(plan, [], [], {
            completedAtMicroseconds: Number(dependencies.wallClock.currentMonotonicMicroseconds),
            planStatus: 'planned',
            processUsage: null,
            startedAtMicroseconds: startedAt,
            testExecutionWallTimeMicroseconds: 0
        });
        const persisted = await record.checkpointResult({ ...partial, artifacts });
        if (persisted.runnerErrors.length > 0) {
            throw new Error(persisted.runnerErrors[0]?.message ?? 'Attachment record checkpoint failed.');
        }
    }
    async function checkpoint(artifacts: readonly RuntimeAttachmentArtifact[]): Promise<void> {
        pending.write(persist(artifacts, pending.read()));
        await pending.read();
    }

    return { checkpoint };
}
export async function createAttachmentRecord(
    resolved: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    session: RunRecordSession | null
): Promise<AttachmentRecord> {
    const record = session ?? createRunRecordSession(
        resolved.cwd,
        {
            config: resolved.config,
            engine: resolved.engine,
            profile: selectProfile(resolved.request.profile, resolved.config),
            projectRoot: resolved.facts.environment.projectRoot,
            request: { ...resolved.request, seed: { value: BigInt(resolved.facts.reproducibility.seed) } }
        },
        await createRunRecordDependencies({
            config: resolved.config,
            engine: resolved.engine,
            profile: selectProfile(resolved.request.profile, resolved.config),
            projectRoot: resolved.facts.environment.projectRoot,
            request: resolved.request
        }, dependencies)
    );
    if (session === null) {
        await record.start(null);
    }
    await record.recordFacts(resolved.facts, recordedRunPlan(resolved));
    const checkpoints = createAttachmentRecordCheckpoint(record, resolved, dependencies);
    return {
        captureTime() {
            return Number(dependencies.wallClock.currentMonotonicMicroseconds);
        },
        async checkpoint(artifacts) {
            return checkpoints.checkpoint(artifacts);
        },
        session: record
    };
}
