import {
    runWithSnapshotContext,
    type SnapshotInput,
    type SnapshotComparison
} from '../packages/baselines/execution-context.entry-point.ts';
import { attachmentsForProducer } from '../packages/resources/attachment-context.entry-point.ts';
import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import type { WorkId } from '../engine/identity.ts';
import { markSnapshotExecutionError } from './snapshot-error.ts';
import { ordinaryBaselineIdentity } from './baseline-record.ts';
import { currentSnapshotRun } from './execution-session-context.ts';
import type { SnapshotRun } from './snapshot-wire.ts';
import { snapshotIdentity, snapshotMediaType } from './snapshot-identity.ts';
import { captureSnapshot, snapshotComparisonValue } from './snapshot-value.ts';

type CapturedSnapshot = ReturnType<typeof captureSnapshot>;

function snapshotExpectation(wire: SnapshotRun, work: WorkId, name: string, format: string): CapturedSnapshot | null {
    const key = baselineIdentityKey(snapshotIdentity(wire.profile, work, name, format));
    return wire
        .entries
        .find(function sameIdentity(entry) {
            return baselineIdentityKey(ordinaryBaselineIdentity(entry)) === key;
        })
        ?.payload ?? null;
}

function acceptsProposal(mode: SnapshotRun['mode'], existing: CapturedSnapshot | null): boolean {
    return mode === 'update' || mode === 'apply' || mode === 'diff' || mode === 'bootstrap' && existing === null;
}

async function captureNamedSnapshot(
    input: SnapshotInput,
    wire: SnapshotRun,
    work: WorkId
): Promise<SnapshotComparison> {
    const payload = captureSnapshot(input, wire.maxBytes);
    const existing = snapshotExpectation(wire, work, input.name, input.kind);
    await attachmentsForProducer({ kind: 'case' }).json({ name: input.name, mediaType: snapshotMediaType }, {
        version: 1,
        name: input.name,
        format: input.kind,
        payload
    });
    if (acceptsProposal(wire.mode, existing)) {
        return { kind: 'accepted' };
    }
    return existing === null ? { kind: 'missing' } : {
        kind: 'compare',
        actual: snapshotComparisonValue(payload, input.kind),
        expected: snapshotComparisonValue(existing, input.kind)
    };
}

async function completeSnapshotAttempt<Value>(run: () => Promise<Value>, failure: () => Error | null): Promise<Value> {
    const result = await run();
    const error = failure();
    if (error !== null) {
        throw error;
    }
    return result;
}

async function executeSnapshotAttempt<Value>(
    work: WorkId,
    wire: SnapshotRun,
    run: () => Promise<Value>
): Promise<Value> {
    const names = new Set<string>();
    let active = true;
    let failure: Error | null = null;
    async function record(input: SnapshotInput): Promise<SnapshotComparison> {
        if (!active) {
            throw new TypeError('Snapshot attempt has completed.');
        }
        const name = input.name.normalize('NFC');
        if (name.trim().length === 0 || names.has(name)) {
            throw new TypeError('Snapshot names must be nonblank and unique within each attempt.');
        }
        names.add(name);
        return await captureNamedSnapshot({ ...input, name }, wire, work);
    }
    const evaluate = async function evaluateNamedSnapshot(input: SnapshotInput): Promise<SnapshotComparison> {
        try {
            return await record(input);
        } catch (error: unknown) {
            failure = markSnapshotExecutionError(error);
            throw failure;
        }
    };
    try {
        return await runWithSnapshotContext({ evaluate }, async function completeAttempt() {
            return await completeSnapshotAttempt(run, function attemptFailure() {
                return failure;
            });
        });
    } finally {
        active = false;
    }
}

export async function runSnapshotAttempt<Value>(work: WorkId, run: () => Promise<Value>): Promise<Value> {
    const wire = currentSnapshotRun();
    return wire === null ? await run() : await executeSnapshotAttempt(work, wire, run);
}
