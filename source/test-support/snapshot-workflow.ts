import { baselineFilename, type StoredOrdinaryBaseline } from '../run/baseline-record.ts';
import { createOrdinaryBaselineWorkflow, type OrdinaryBaselineWorkflow } from '../run/baseline-workflow.ts';
import { evaluateSnapshot, type SnapshotInput } from '../baselines/snapshot-context.ts';
import type { BaselineCaseEnd } from '../run/baseline-outcomes.ts';
import { defaultRunRequest } from './run-command-factory.ts';
import { recordSnapshotAttempt, snapshotWire, storedSnapshot } from './snapshot-fixture.ts';
import { memoryOrdinaryBaselines } from './memory-ordinary-baselines.ts';
import { attachmentWork } from './attachment-fixture.ts';
import { baselineCaseEvent } from './baseline-case-fixture.ts';

export async function snapshotWorkflow(initial: readonly StoredOrdinaryBaseline[]): Promise<OrdinaryBaselineWorkflow> {
    return await createOrdinaryBaselineWorkflow({
        store: memoryOrdinaryBaselines(initial),
        policy: { directory: 'baselines', snapshots: true, stale: 'fail', adapters: [] },
        projectRoot: '/project',
        request: defaultRunRequest({ profile: snapshotWire.profile, baselineUpdateMode: 'update' })
    });
}
export async function snapshotEvent(inputs: readonly SnapshotInput[]): Promise<BaselineCaseEnd> {
    const captured = await recordSnapshotAttempt({ ...snapshotWire, mode: 'update' }, async function () {
        for (const input of inputs) {
            await evaluateSnapshot(input);
        }
    });
    return { ...baselineCaseEvent, case: attachmentWork.case, workId: attachmentWork, artifacts: captured.artifacts };
}

type SnapshotUpdateFixture = {
    readonly workflow: OrdinaryBaselineWorkflow;
    readonly event: BaselineCaseEnd;
    readonly filenames: readonly string[];
};
export async function snapshotUpdateFixture(): Promise<SnapshotUpdateFixture> {
    const initial = [ 'first', 'second' ]
        .map(function (name) {
            return storedSnapshot({ kind: 'text', name, actual: 'old' });
        })
        .toSorted(function (left, right) {
            return baselineFilename(right).localeCompare(baselineFilename(left));
        });
    const first = initial[0];
    if (first === undefined) {
        throw new Error('Expected initial snapshots.');
    }
    const workflow = await snapshotWorkflow([ ...initial, { ...first, profile: 'unrelated' } ]);
    const event = await snapshotEvent(initial.map(function (baseline) {
        const { name } = baseline.comparisonContext;
        if (typeof name !== 'string') {
            throw new TypeError('Expected snapshot name.');
        }
        return { kind: 'text', name, actual: 'new' };
    }));
    return {
        workflow,
        event,
        filenames: initial.map(baselineFilename).toSorted(function (left, right) {
            return left.localeCompare(right);
        })
    };
}
