import path from 'node:path';
import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';
import { workIdentityKey } from '../engine/identity.ts';
import type { HistoryPolicy } from '../config/history-policy.ts';
import {
    durationHistoryIndexSchema,
    durationObservationSchema,
    durationWorkIdSchema
} from './duration-history-schema.ts';
import type { DurationHistoryIndex, DurationHistoryStore } from './duration-history-types.ts';
import type { DurationHistoryObservation } from './run-types.ts';
import {
    historyStateError,
    assertSupportedHistoryVersion,
    UnsupportedHistoryVersionError
} from './history-state-error.ts';

const durationStateVersion = 3;
const millisecondsPerDay = 86_400_000;
const timestamp = z.iso.datetime({ offset: true });
const counter = z.number().nonnegative();
const storedObservationSchema = z.strictObject({
    runId: z.string().nullable(),
    value: durationObservationSchema
});
export const durationHistoryStateSchema = z.strictObject({
    version: z.literal(durationStateVersion),
    updatedAt: timestamp,
    legacyCutoff: timestamp.nullable(),
    appliedRuns: z.array(z.strictObject({ id: z.string(), startedAt: timestamp })),
    entries: z.array(z.strictObject({
        work: durationWorkIdSchema,
        observations: z.array(storedObservationSchema),
        count: counter.int(),
        totalDurationMicroseconds: counter
    }))
});
export type DurationHistoryState = ReadonlyDeep<z.output<typeof durationHistoryStateSchema>>;

export function durationStatePath(directory: string): string {
    return path.join(directory, 'duration-history', 'work-durations.json');
}

export function emptyDurationState(now: string): DurationHistoryState {
    return { version: durationStateVersion, updatedAt: now, legacyCutoff: null, appliedRuns: [], entries: [] };
}

function migrateDurationIndex(legacy: DurationHistoryIndex, now: string): DurationHistoryState {
    return {
        version: durationStateVersion,
        updatedAt: legacy.updatedAt,
        legacyCutoff: now,
        appliedRuns: [],
        entries: legacy.entries.map(function migrateEntry(entry) {
            return {
                work: entry.work,
                count: entry.observations.length,
                totalDurationMicroseconds: entry.observations.reduce(function sum(total, observation) {
                    return total + observation.durationMicroseconds;
                }, 0),
                observations: entry.observations.map(function preserveLegacy(value) {
                    return { runId: null, value };
                })
            };
        })
    };
}

function parseDurationState(source: string, now: string): DurationHistoryState {
    assertSupportedHistoryVersion(source, durationStateVersion);
    const value: unknown = JSON.parse(source);
    const current = durationHistoryStateSchema.safeParse(value);
    return current.success ? current.data : migrateDurationIndex(durationHistoryIndexSchema.parse(value), now);
}

async function storedDurationState(
    store: DurationHistoryStore,
    directory: string,
    now: string
): Promise<DurationHistoryState | null> {
    const source = await store.read(durationStatePath(directory));
    return source === null ? null : parseDurationState(source, now);
}

export async function readDurationState(
    store: DurationHistoryStore,
    directory: string,
    now: string
): Promise<DurationHistoryState | null> {
    try {
        return await storedDurationState(store, directory, now);
    } catch (error: unknown) {
        if (error instanceof UnsupportedHistoryVersionError) {
            throw error;
        }
        throw historyStateError(error);
    }
}

export function durationIndexProjection(
    state: DurationHistoryState,
    completed: ReadonlySet<string>
): DurationHistoryIndex {
    return {
        version: 2,
        updatedAt: state.updatedAt,
        entries: state.entries.map(function projectEntry(entry) {
            return {
                work: entry.work,
                observations: entry.observations.flatMap(function committedObservation(observation) {
                    return observation.runId === null || completed.has(observation.runId) ? [ observation.value ] : [];
                })
            };
        })
    };
}

export type DurationContribution = {
    readonly work: z.output<typeof durationWorkIdSchema>;
    readonly observation: DurationHistoryObservation;
};

type DurationIngestion = {
    readonly run: { readonly id: string; readonly startedAt: string; } | null;
    readonly policy: HistoryPolicy;
    readonly now: string;
    readonly source: 'repair' | 'run';
};

function shouldSkipRun(state: DurationHistoryState, context: DurationIngestion): boolean {
    const { run } = context;
    if (run === null) {
        return false;
    }
    if (
        state.appliedRuns.some(function alreadyApplied(value) {
            return value.id === run.id;
        })
    ) {
        return true;
    }
    const cutoff = Date.parse(context.now) - context.policy.staleIdentityRetentionDays * millisecondsPerDay;
    if (Date.parse(run.startedAt) < cutoff) {
        return true;
    }
    return context.source === 'repair' && state.legacyCutoff !== null && run.startedAt <= state.legacyCutoff;
}

type DurationEntry = DurationHistoryState['entries'][number];
function appendContribution(
    previous: DurationEntry,
    contribution: DurationContribution,
    runId: string | null
): DurationEntry {
    return {
        ...previous,
        count: previous.count + 1,
        totalDurationMicroseconds: previous.totalDurationMicroseconds + contribution.observation.durationMicroseconds,
        observations: [ ...previous.observations, { runId, value: contribution.observation } ]
    };
}

function retainDurationEntries(
    entries: readonly DurationEntry[],
    context: DurationIngestion
): readonly DurationEntry[] {
    const cutoff = Date.parse(context.now) - context.policy.staleIdentityRetentionDays * millisecondsPerDay;
    return entries.flatMap(function retainWork(entry) {
        const observations = entry
            .observations
            .toSorted(function latest(left, right) {
                const timeOrder = Date.parse(right.value.observedAt) - Date.parse(left.value.observedAt);
                return timeOrder === 0 ? (left.runId ?? '').localeCompare(right.runId ?? '') : timeOrder;
            })
            .slice(0, context.policy.observationsPerIdentity);
        const latest = observations[0];
        return latest === undefined || Date.parse(latest.value.observedAt) < cutoff
            ? []
            : [ { ...entry, observations } ];
    });
}

function mergedDurationEntries(
    state: DurationHistoryState,
    observations: readonly DurationContribution[],
    runId: string | null
): readonly DurationEntry[] {
    const entries = new Map(state.entries.map(function workEntry(entry) {
        return [ workIdentityKey(entry.work), entry ];
    }));
    for (const contribution of observations) {
        const key = workIdentityKey(contribution.work);
        const previous = entries.get(key) ??
            { work: contribution.work, count: 0, totalDurationMicroseconds: 0, observations: [] };
        entries.set(key, appendContribution(previous, contribution, runId));
    }
    return Array.from(entries.values());
}

export function ingestDurationState(
    state: DurationHistoryState,
    observations: readonly DurationContribution[],
    context: DurationIngestion
): DurationHistoryState {
    if (shouldSkipRun(state, context)) {
        return state;
    }
    const entries = mergedDurationEntries(state, observations, context.run?.id ?? null);
    const runs = [ ...state.appliedRuns, ...context.run === null ? [] : [ context.run ] ];
    const cutoff = Date.parse(context.now) - context.policy.staleIdentityRetentionDays * millisecondsPerDay;
    return {
        ...state,
        updatedAt: context.now,
        appliedRuns: runs.filter(function freshRun(value) {
            return Date.parse(value.startedAt) >= cutoff;
        }),
        entries: retainDurationEntries(entries, context)
    };
}

export type DurationLearningContext = {
    readonly directory: string;
    readonly policy: HistoryPolicy;
    readonly now: string;
};

export async function writeLearnedDurations(
    store: DurationHistoryStore,
    observations: DurationHistoryIndex['entries'],
    context: DurationLearningContext
): Promise<void> {
    const state = await readDurationState(store, context.directory, context.now) ?? emptyDurationState(context.now);
    const contributions = observations.flatMap(function workObservations(entry) {
        return entry.observations.map(function contribution(observation) {
            return { work: entry.work, observation };
        });
    });
    const next = ingestDurationState(state, contributions, {
        run: null,
        policy: context.policy,
        now: context.now,
        source: 'run'
    });
    await store.write(durationStatePath(context.directory), JSON.stringify(durationHistoryStateSchema.parse(next)));
}
