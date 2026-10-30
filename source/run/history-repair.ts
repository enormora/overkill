import path from 'node:path';
import { z } from 'zod';
import type { HistoryPolicy } from '../config/history-policy.ts';
import { emptyCompactHistory, ingestCompactRecord, retainCompactHistory } from './compact-history.ts';
import { compactHistorySchema, type CompactHistory } from './compact-history-schema.ts';
import { historyRecordSchema, type HistoryRecord } from './history-record.ts';
import {
    historyStateError,
    assertSupportedHistoryVersion,
    UnsupportedHistoryVersionError
} from './history-state-error.ts';
import { recordDurationContributions } from './history-outcomes.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import {
    durationHistoryStateSchema,
    durationStatePath,
    emptyDurationState,
    ingestDurationState,
    readDurationState,
    type DurationHistoryState
} from './duration-history-storage.ts';

export type HistoryRepairResult = {
    readonly rebuiltRunCount: number;
    readonly diagnostics: readonly string[];
    readonly dataLoss: boolean;
};
type RepairContext = {
    readonly directory: string;
    readonly policy: HistoryPolicy;
    readonly mode: 'automatic' | 'explicit';
    readonly now: string;
};
type RepairPart<T> = { readonly value: T; readonly dataLoss: boolean; readonly diagnostics: readonly string[]; };
type RepairState = {
    readonly index: CompactHistory;
    readonly durations: DurationHistoryState;
    readonly dataLoss: boolean;
    readonly diagnostics: readonly string[];
};
const automaticRepairBudgetMilliseconds = 2000;

function assertBudget(deadline: number): void {
    if (performance.now() > deadline) {
        throw historyStateError('Automatic history repair exceeded its two-second budget.');
    }
}

const legacyIndexSchema = compactHistorySchema.extend({ version: z.literal(0) });
function recoverIndexValue(source: string): CompactHistory {
    const value: unknown = JSON.parse(source);
    const legacy = legacyIndexSchema.safeParse(value);
    return legacy.success ? { ...legacy.data, version: 1 } : compactHistorySchema.parse(value);
}

async function recoverIndex(store: HistoryStorage, context: RepairContext): Promise<RepairPart<CompactHistory>> {
    const source = await store.read(path.join(context.directory, 'history', 'index.json'));
    if (source === null) {
        return { value: emptyCompactHistory(context.now), dataLoss: false, diagnostics: [] };
    }
    assertSupportedHistoryVersion(source, 1);
    try {
        return { value: recoverIndexValue(source), dataLoss: false, diagnostics: [] };
    } catch (error: unknown) {
        if (context.mode === 'automatic') {
            throw historyStateError(error);
        }
        return {
            value: emptyCompactHistory(context.now),
            dataLoss: true,
            diagnostics: [
                'Unreadable compact history was rebuilt. Pruned summaries, observations, and counters may be lost.'
            ]
        };
    }
}

async function durationRepairPart(
    store: HistoryStorage,
    context: RepairContext
): Promise<RepairPart<DurationHistoryState>> {
    const existing = await readDurationState(store, context.directory, context.now);
    return { value: existing ?? emptyDurationState(context.now), dataLoss: false, diagnostics: [] };
}

async function recoverDurations(
    store: HistoryStorage,
    context: RepairContext
): Promise<RepairPart<DurationHistoryState>> {
    try {
        return await durationRepairPart(store, context);
    } catch (error: unknown) {
        if (context.mode === 'automatic' || error instanceof UnsupportedHistoryVersionError) {
            throw error;
        }
        return {
            value: emptyDurationState(context.now),
            dataLoss: true,
            diagnostics: [ 'Unreadable duration history was rebuilt. Samples without retained records may be lost.' ]
        };
    }
}

async function repairState(store: HistoryStorage, context: RepairContext): Promise<RepairState> {
    const [ index, durations ] = await Promise.all([ recoverIndex(store, context), recoverDurations(store, context) ]);
    return {
        index: index.value,
        durations: durations.value,
        dataLoss: index.dataLoss || durations.dataLoss,
        diagnostics: [ ...index.diagnostics, ...durations.diagnostics ]
    };
}

function missingRecordFamily(state: RepairState, record: HistoryRecord, context: RepairContext): RepairState {
    if (context.mode === 'automatic') {
        throw historyStateError(`Cannot recover test family for ${record.id}.`);
    }
    return {
        ...state,
        index: ingestCompactRecord(state.index, record, { ...context, testFamily: null }),
        dataLoss: true,
        diagnostics: [
            ...state.diagnostics,
            `Unresolved record ${record.id} has no recoverable test family; its summary could not be restored.`
        ]
    };
}

function recoverRecord(state: RepairState, record: HistoryRecord, context: RepairContext): RepairState {
    const previous = state.index.summaries.find(function matchingRun(value) {
        return value.id === record.id;
    });
    const testFamily = record.facts?.execution.testFamily ?? previous?.testFamily;
    const durations = record.status === 'completed'
        ? ingestDurationState(state.durations, recordDurationContributions(record), {
            run: { id: record.id, startedAt: record.startedAt },
            source: 'repair',
            policy: context.policy,
            now: context.now
        })
        : state.durations;
    if (testFamily === undefined) {
        return missingRecordFamily({ ...state, durations }, record, context);
    }
    return { ...state, durations, index: ingestCompactRecord(state.index, record, { ...context, testFamily }) };
}

async function rebuildRecords(
    store: HistoryStorage,
    context: RepairContext,
    paths: readonly string[],
    deadline: number
): Promise<RepairState> {
    let state = await repairState(store, context);
    for (const recordPath of paths) {
        assertBudget(deadline);
        const source = await store.read(recordPath);
        if (source === null) {
            throw historyStateError(`Record disappeared during repair: ${recordPath}`);
        }
        state = recoverRecord(state, historyRecordSchema.parse(JSON.parse(source)), context);
    }
    if (context.mode === 'automatic' && paths.length === 0 && state.index.summaries.length === 0) {
        throw historyStateError('Retained records are insufficient for automatic repair.');
    }
    return state;
}

async function publishRepair(
    store: HistoryStorage,
    context: RepairContext,
    state: RepairState,
    paths: readonly string[]
): Promise<void> {
    const available = new Set(paths);
    const index = retainCompactHistory(
        {
            ...state.index,
            summaries: state
                .index
                .summaries
                .map(function replayAvailability(summary) {
                    return {
                        ...summary,
                        replayable: summary.replayable &&
                            available.has(path.join(context.directory, 'runs', `${summary.id}.json`))
                    };
                })
        },
        context.policy,
        context.now
    );
    const validDurations = durationHistoryStateSchema.parse(state.durations);
    const validIndex = compactHistorySchema.parse(index);
    await store.write(durationStatePath(context.directory), JSON.stringify(validDurations));
    await store.write(path.join(context.directory, 'history', 'index.json'), JSON.stringify(validIndex));
}

export async function repairHistory(store: HistoryStorage, context: RepairContext): Promise<HistoryRepairResult> {
    try {
        return await store.withLock(async function rebuildHistory() {
            const deadline = context.mode === 'automatic'
                ? performance.now() + automaticRepairBudgetMilliseconds
                : Number.POSITIVE_INFINITY;
            const listed = await store.list(path.join(context.directory, 'runs'));
            const paths = listed.toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            });
            const state = await rebuildRecords(store, context, paths, deadline);
            assertBudget(deadline);
            await publishRepair(store, context, state, paths);
            return { rebuiltRunCount: paths.length, diagnostics: state.diagnostics, dataLoss: state.dataLoss };
        });
    } catch (error: unknown) {
        throw historyStateError(error);
    }
}
