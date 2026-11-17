import path from 'node:path';
import { workIdentityKey } from '../engine/identity.ts';
import { readDurationProjection } from './history-reader.ts';
import type {
    DurationHistoryInput,
    DurationHistoryObservation,
    DurationHistorySample,
    WorkId,
    WorkUnit
} from './run-types.ts';
import type { DurationHistoryIndex, DurationHistoryPlacement, DurationHistoryStore } from './duration-history-types.ts';

const maximumObservationCount = 8;
const freshnessDays = 30;
const hoursPerDay = 24;
const minutesPerHour = 60;
const secondsPerMinute = 60;
const millisecondsPerSecond = 1000;
const freshnessMilliseconds = freshnessDays *
    hoursPerDay *
    minutesPerHour *
    secondsPerMinute *
    millisecondsPerSecond;
const minimumCoverageRatio = 0.5;
const evenSampleDivisor = 2;

type DurationHistoryEntry = DurationHistoryIndex['entries'][number];

export async function readDurationHistoryIndex(
    store: DurationHistoryStore,
    projectRoot: string,
    runtimeStateDir: string
): Promise<DurationHistoryIndex | null> {
    return await readDurationProjection(store, path.resolve(projectRoot, runtimeStateDir));
}

function finiteDuration(durationMicroseconds: number): boolean {
    return Number.isFinite(durationMicroseconds) && durationMicroseconds >= 0;
}

function observedAtMilliseconds(observation: DurationHistoryObservation): number {
    const observedAt = new Date(observation.observedAt);

    return observedAt.getTime();
}

function isoTimestamp(milliseconds: number): string {
    const timestamp = new Date(milliseconds);

    return timestamp.toISOString();
}

function freshObservation(nowMilliseconds: number): (observation: DurationHistoryObservation) => boolean {
    return function observationIsFresh(observation) {
        const observedAt = observedAtMilliseconds(observation);

        return Number.isFinite(observedAt) &&
            observedAt <= nowMilliseconds &&
            nowMilliseconds - observedAt <= freshnessMilliseconds &&
            finiteDuration(observation.durationMicroseconds);
    };
}

function sortedRecentObservations(
    observations: readonly DurationHistoryObservation[]
): readonly DurationHistoryObservation[] {
    return observations
        .toSorted(function compareObservedAt(left, right) {
            const difference = observedAtMilliseconds(right) - observedAtMilliseconds(left);

            return difference === 0
                ? left.durationMicroseconds - right.durationMicroseconds
                : difference;
        })
        .slice(0, maximumObservationCount);
}

function median(values: readonly number[]): number {
    const sorted = values.toSorted(function compareNumber(left, right) {
        return left - right;
    });
    const middle = Math.floor(sorted.length / evenSampleDivisor);
    const middleValue = sorted[middle];

    if (middleValue === undefined) {
        throw new Error('Median requires at least one value.');
    }

    if (sorted.length % evenSampleDivisor === 1) {
        return middleValue;
    }

    return ((sorted[middle - 1] ?? middleValue) + middleValue) / evenSampleDivisor;
}

function sampleFromEntry(entry: DurationHistoryEntry, nowMilliseconds: number): DurationHistorySample | null {
    const observations = sortedRecentObservations(entry.observations.filter(freshObservation(nowMilliseconds)));
    const latest = observations[0];

    if (latest === undefined) {
        return null;
    }

    return {
        durationMicroseconds: median(observations.map(function toDuration(observation) {
            return observation.durationMicroseconds;
        })),
        observedAt: latest.observedAt,
        observations,
        sampleCount: observations.length,
        work: entry.work
    };
}

type SampleEntry = readonly [string, DurationHistorySample];

function sampleEntryFromEntry(entry: DurationHistoryEntry, nowMilliseconds: number): SampleEntry | null {
    const sample = sampleFromEntry(entry, nowMilliseconds);

    return sample === null ? null : [ workIdentityKey(entry.work), sample ];
}

function isSampleEntry(entry: SampleEntry | null): entry is SampleEntry {
    return entry !== null;
}

function samplesByWorkKey(
    index: DurationHistoryIndex,
    nowMilliseconds: number
): ReadonlyMap<string, DurationHistorySample> {
    return new Map(
        index
            .entries
            .map(function toSampleEntry(entry) {
                return sampleEntryFromEntry(entry, nowMilliseconds);
            })
            .filter(isSampleEntry)
    );
}

function uniqueWork(units: readonly WorkUnit[]): readonly WorkId[] {
    const works = new Map<string, WorkId>();

    for (const unit of units) {
        for (const work of unit.work) {
            works.set(workIdentityKey(work), work);
        }
    }

    return Array.from(works.values());
}

function durationFacts(samples: readonly DurationHistorySample[], nowMilliseconds: number): DurationHistoryInput {
    return {
        generatedAt: isoTimestamp(nowMilliseconds),
        samples: samples.toSorted(function compareSample(left, right) {
            return workIdentityKey(left.work).localeCompare(workIdentityKey(right.work));
        }),
        source: 'runtime-state-index'
    };
}

export function selectDurationHistoryPlacement(
    units: readonly WorkUnit[],
    index: DurationHistoryIndex | null,
    nowMilliseconds: number
): DurationHistoryPlacement {
    if (index === null) {
        return { facts: null, unitDuration: null };
    }

    const currentWork = uniqueWork(units);
    const samples = samplesByWorkKey(index, nowMilliseconds);
    const matchedSamples = currentWork.flatMap(function toSample(work) {
        const sample = samples.get(workIdentityKey(work));

        return sample === undefined ? [] : [ sample ];
    });

    if (currentWork.length === 0 || matchedSamples.length / currentWork.length < minimumCoverageRatio) {
        return { facts: null, unitDuration: null };
    }

    const fallbackDuration = median(matchedSamples.map(function toDuration(sample) {
        return sample.durationMicroseconds;
    }));
    const durationByWorkKey = new Map(matchedSamples.map(function toEntry(sample) {
        return [ workIdentityKey(sample.work), sample.durationMicroseconds ];
    }));

    return {
        facts: durationFacts(matchedSamples, nowMilliseconds),
        unitDuration(unit) {
            const workDuration = unit.work.reduce(function sumDuration(total, work) {
                return total + (durationByWorkKey.get(workIdentityKey(work)) ?? fallbackDuration);
            }, 0);

            return workDuration * unit.resourceConstraints.capacityWeight;
        }
    };
}
