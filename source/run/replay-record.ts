import path from 'node:path';
import { workIdentityKey } from '../engine/identity.ts';
import type { ReplayRunRecord } from './replay-record-types.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import { invalidRequest } from './run-errors.ts';
import { decodeReplayInput, readReplayFile } from './replay-input.ts';
import { replayRecordSchema } from './replay-record-schema.ts';
import { compileReplayTrace } from './replay-trace-plan.ts';
import type { ReplayRunCommand } from './replay-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

function assertRecordedIdentities(record: ReplayRunRecord): void {
    const identities = record.identities.map(workIdentityKey);
    const cases = record.facts.cases.map(function identity(entry) {
        return workIdentityKey(entry.workId);
    });
    const entries = collectedRunCaseEntries(record.replayPlan);
    const metadata = new Set(
        entries.map(function identity(entry) {
            return workIdentityKey(entry.workId);
        })
    );
    const uniqueIdentities = new Set(identities);
    if (
        uniqueIdentities.size !== identities.length || metadata.size !== identities.length ||
        cases.length !== identities.length || entries.length !== identities.length ||
        identities.some(function inconsistent(key, index) {
            return cases[index] !== key || !metadata.has(key);
        })
    ) {
        invalidRequest('Run record contains inconsistent or duplicate work identities.');
    }
}
function assertPlacementIdentities(record: ReplayRunRecord): void {
    const plan = record.facts.execution.placementPlan;
    if (plan === null) {
        return;
    }
    const expected = new Set(record.identities.map(workIdentityKey));
    const work = plan.units.flatMap(function members(unit) {
        return unit.work.map(workIdentityKey);
    });
    if (
        work.length !== record.identities.length || work.some(function unrelated(key) {
            return !expected.has(key);
        })
    ) {
        invalidRequest('Run record placement and selected identities are inconsistent.');
    }
}
function missingDynamicTrace(record: ReplayRunRecord): boolean {
    if (record.status !== 'completed' || record.facts.execution.dispatchPolicy !== 'dynamic-lease') {
        return false;
    }
    return record.placementTrace?.entries.some(function assigned(entry) {
        return entry.kind === 'attempt-assigned';
    }) !== true;
}
function assertTraceHasPlacement(record: ReplayRunRecord): void {
    if (record.placementTrace !== null && record.placementTrace.entries.length > 0) {
        invalidRequest('Recorded trace has no placement plan.');
    }
}
function validateRecordedTrace(record: ReplayRunRecord): void {
    const plan = record.facts.execution.placementPlan;
    if (plan === null) {
        assertTraceHasPlacement(record);
        return;
    }
    assertPlacementIdentities(record);
    if (plan.units.length > 0 && missingDynamicTrace(record)) {
        invalidRequest('Completed dynamic run has no replayable scheduling decisions.');
    }
    compileReplayTrace(plan, record);
}
export async function readRecordedReplay(
    input: ReplayRunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<ReplayRunRecord> {
    if (!/^[A-Za-z0-9_-]+$/u.test(input.runId)) {
        invalidRequest('Replay requires a retained run id.');
    }
    const file = path.resolve(input.cwd, input.config.runtimeStateDir, 'runs', `${input.runId}.json`);
    const raw = await readReplayFile(file, dependencies);
    const record = decodeReplayInput(raw, function decode(value) {
        return replayRecordSchema.parse(value);
    });
    if (
        record.id !== input.runId || record.seed !== record.request.seed.value ||
        record.seed !== record.facts.reproducibility.seed
    ) {
        invalidRequest('Run record identity or seed is inconsistent.');
    }
    assertRecordedIdentities(record);
    decodeReplayInput(record, function validate() {
        validateRecordedTrace(record);
    });
    return record;
}
