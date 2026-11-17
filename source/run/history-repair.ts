import path from 'node:path';
import type { HistoryOptions, HistoryRepairResult } from './history-types.ts';
import { emptyCompactHistory, ingestCompactRecord, retainCompactHistory } from './compact-history.ts';
import { compactHistorySchema, type CompactHistory } from './compact-history-schema.ts';
import { historyRecordSchema, type HistoryRecord } from './history-record.ts';
import {
    historyStateError,
    assertSupportedHistoryVersion
} from './history-state-error.ts';
import type { HistoryStorage } from './history-storage-types.ts';

type RepairContext = {
    readonly directory: string;
    readonly policy: HistoryOptions['config']['history'];
    readonly mode: 'automatic' | 'explicit';
    readonly now: string;
};
type RepairPart<T> = { readonly value: T; readonly dataLoss: boolean; readonly diagnostics: readonly string[]; };
type RepairState = {
    readonly index: CompactHistory;
    readonly rebuiltRunCount: number;
    readonly dataLoss: boolean;
    readonly diagnostics: readonly string[];
};
const automaticRepairBudgetMilliseconds = 2000;

function assertBudget(deadline: number): void {
    if (performance.now() > deadline) {
        throw historyStateError('Automatic history repair exceeded its two-second budget.');
    }
}

async function recoverIndex(store: HistoryStorage, context: RepairContext): Promise<RepairPart<CompactHistory>> {
    const source = await store.read(path.join(context.directory, 'history', 'index.json'));
    if (source === null) {
        return { value: emptyCompactHistory(context.now), dataLoss: false, diagnostics: [] };
    }
    assertSupportedHistoryVersion(source, 1);
    try {
        return { value: compactHistorySchema.parse(JSON.parse(source)), dataLoss: false, diagnostics: [] };
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

async function repairState(store: HistoryStorage, context: RepairContext): Promise<RepairState> {
    const index = await recoverIndex(store, context);
    return {
        index: index.value,
        rebuiltRunCount: 0,
        dataLoss: index.dataLoss,
        diagnostics: index.diagnostics
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
    if (testFamily === undefined) {
        return missingRecordFamily(state, record, context);
    }
    return { ...state, index: ingestCompactRecord(state.index, record, { ...context, testFamily }) };
}

async function rebuildRecord(
    store: HistoryStorage,
    context: RepairContext,
    state: RepairState,
    recordPath: string
): Promise<RepairState> {
    const source = await store.read(recordPath);
    if (source === null) {
        throw historyStateError(`Record disappeared during repair: ${recordPath}`);
    }
    const record = historyRecordSchema.parse(JSON.parse(source));
    return record.request.recordForMerge
        ? state
        : recoverRecord({ ...state, rebuiltRunCount: state.rebuiltRunCount + 1 }, record, context);
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
        state = await rebuildRecord(store, context, state, recordPath);
    }
    if (context.mode === 'automatic' && state.rebuiltRunCount === 0 && state.index.summaries.length === 0) {
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
    const validIndex = compactHistorySchema.parse(index);
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
            return { rebuiltRunCount: state.rebuiltRunCount, diagnostics: state.diagnostics, dataLoss: state.dataLoss };
        });
    } catch (error: unknown) {
        throw historyStateError(error);
    }
}
