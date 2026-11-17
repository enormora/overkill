import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';
import { workIdSchema } from '../engine/identity-schema.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { HistoryPolicy } from '../config/history-policy.ts';
import {
    durationObservationSchema
} from './duration-history-schema.ts';
import type { DurationHistoryIndex } from './duration-history-types.ts';
import type { DurationHistoryObservation, WorkId } from './run-types.ts';

const millisecondsPerDay = 86_400_000;
const timestamp = z.iso.datetime({ offset: true });
const counter = z.number().nonnegative();
const storedObservationSchema = z.strictObject({
    runId: z.string().nullable(),
    value: durationObservationSchema
});
export const durationHistoryStateSchema = z.strictObject({
    updatedAt: timestamp,
    entries: z.array(z.strictObject({
        work: workIdSchema,
        observations: z.array(storedObservationSchema),
        count: counter.int(),
        totalDurationMicroseconds: counter
    }))
});
export type DurationHistoryState = ReadonlyDeep<z.output<typeof durationHistoryStateSchema>>;

export function emptyDurationState(now: string): DurationHistoryState {
    return { updatedAt: now, entries: [] };
}

export function durationIndexProjection(
    state: DurationHistoryState,
    completed: ReadonlySet<string>
): DurationHistoryIndex {
    return {
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
    readonly work: WorkId;
    readonly observation: DurationHistoryObservation;
};

type DurationIngestion = {
    readonly run: { readonly id: string; readonly startedAt: string; } | null;
    readonly policy: HistoryPolicy;
    readonly now: string;
};

function shouldSkipRun(context: DurationIngestion): boolean {
    const { run } = context;
    if (run === null) {
        return false;
    }
    const cutoff = Date.parse(context.now) - context.policy.staleIdentityRetentionDays * millisecondsPerDay;
    if (Date.parse(run.startedAt) < cutoff) {
        return true;
    }
    return false;
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
    if (shouldSkipRun(context)) {
        return state;
    }
    const entries = mergedDurationEntries(state, observations, context.run?.id ?? null);
    return {
        ...state,
        updatedAt: context.now,
        entries: retainDurationEntries(entries, context)
    };
}
