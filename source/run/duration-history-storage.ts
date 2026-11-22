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
export const caseHistoryStatusSchema = z.enum([ 'failed', 'inconclusive', 'passed', 'skipped' ]);
const familyVerdictSchema = z.strictObject({
    runId: z.string(),
    observedAt: timestamp,
    status: caseHistoryStatusSchema
});
export type CaseHistoryStatus = z.output<typeof caseHistoryStatusSchema>;

export const durationHistoryStateSchema = z.strictObject({
    updatedAt: timestamp,
    entries: z.array(z.strictObject({
        work: workIdSchema,
        familyVerdicts: z.array(familyVerdictSchema).default([]),
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

export type FamilyVerdictContribution = { readonly work: WorkId; readonly status: CaseHistoryStatus; };

type DurationIngestion = {
    readonly familyVerdicts: readonly FamilyVerdictContribution[];
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

function emptyWorkEntry(work: WorkId): DurationEntry {
    return { work, count: 0, totalDurationMicroseconds: 0, observations: [], familyVerdicts: [] };
}

function retainWorkEntries(
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
        const familyVerdicts = entry
            .familyVerdicts
            .filter(function recentVerdict(verdict) {
                return Date.parse(verdict.observedAt) >= cutoff;
            })
            .toSorted(function latest(left, right) {
                const timeOrder = Date.parse(right.observedAt) - Date.parse(left.observedAt);
                return timeOrder === 0 ? left.runId.localeCompare(right.runId) : timeOrder;
            })
            .slice(0, context.policy.observationsPerIdentity);
        const latest = observations[0];
        if (latest !== undefined && Date.parse(latest.value.observedAt) >= cutoff) {
            return [ { ...entry, observations, familyVerdicts } ];
        }
        return familyVerdicts.length === 0 ? [] : [ { ...emptyWorkEntry(entry.work), familyVerdicts } ];
    });
}

function workEntriesWithVerdicts(
    entries: readonly DurationEntry[],
    context: DurationIngestion
): Map<string, DurationEntry> {
    const next = new Map(entries.map(function workEntry(entry) {
        return [ workIdentityKey(entry.work), entry ];
    }));
    const { run, familyVerdicts } = context;
    if (run === null) {
        return next;
    }
    for (const { work, status } of familyVerdicts) {
        const key = workIdentityKey(work);
        const previous = next.get(key) ?? emptyWorkEntry(work);
        next.set(key, {
            ...previous,
            familyVerdicts: [ ...previous.familyVerdicts, { runId: run.id, observedAt: run.startedAt, status } ]
        });
    }
    return next;
}

function mergedWorkEntries(
    state: DurationHistoryState,
    observations: readonly DurationContribution[],
    context: DurationIngestion
): readonly DurationEntry[] {
    const entries = workEntriesWithVerdicts(state.entries, context);
    for (const contribution of observations) {
        const key = workIdentityKey(contribution.work);
        const previous = entries.get(key) ?? emptyWorkEntry(contribution.work);
        entries.set(key, appendContribution(previous, contribution, context.run?.id ?? null));
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
    const entries = mergedWorkEntries(state, observations, context);
    return {
        ...state,
        updatedAt: context.now,
        entries: retainWorkEntries(entries, context)
    };
}
