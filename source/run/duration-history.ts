import path from 'node:path';
import { z } from 'zod';
import type { PerTestResult, RunnerError, RunResult } from '../engine/run-result.ts';
import { RunCollectionError } from './run-errors.ts';
import type {
    DurationHistoryInput,
    DurationHistoryObservation,
    DurationHistorySample,
    ResolvedRun,
    WorkId,
    WorkUnit
} from './run-types.ts';

const indexVersion = 1;
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
const durationHistoryPathParts = [ 'duration-history', 'work-durations.json' ];

export type DurationHistoryIndex = {
    readonly entries: readonly DurationHistoryEntry[];
    readonly updatedAt: string;
    readonly version: typeof indexVersion;
};

type DurationHistoryEntry = {
    readonly observations: readonly DurationHistoryObservation[];
    readonly work: WorkId;
};

type DurationHistoryObservationMetadata = DurationHistoryObservation['metadata'];

export type DurationHistoryPlacement = {
    readonly facts: DurationHistoryInput | null;
    readonly unitDuration: ((unit: WorkUnit) => number) | null;
};

export type DurationHistoryStore = {
    readonly read: (filePath: string) => Promise<string | null>;
    readonly write: (filePath: string, content: string) => Promise<void>;
};

type DurationHistoryResult = {
    readonly perTest: readonly PerTestResult[];
};

const stringRecordSchema = z.record(z.string(), z.string()).readonly();

const caseIdSchema = z
    .strictObject({
        file: z.string().nullable(),
        params: z.string().nullable(),
        suite: z.array(z.string()).readonly(),
        title: z.string()
    })
    .readonly();

const runtimeIdSchema = z
    .strictObject({
        dimensions: stringRecordSchema,
        name: z.string(),
        variantId: z.string().nullable()
    })
    .readonly();

const workloadIdSchema = z
    .strictObject({
        name: z.string(),
        params: stringRecordSchema
    })
    .readonly();

const workIdSchema = z
    .strictObject({
        case: caseIdSchema,
        runtimes: z.array(runtimeIdSchema).readonly(),
        workload: workloadIdSchema.nullable()
    })
    .readonly();

const metadataSchema = z
    .strictObject({
        processModel: z.union([
            z.literal('in-process'),
            z.literal('supervised-process'),
            z.literal('worker-pool')
        ]),
        profile: z.string(),
        scheduling: z.union([ z.literal('concurrent'), z.literal('serial') ]),
        testFamily: z.union([ z.literal('integration'), z.literal('microtest') ]),
        workerLifecycle: z.union([ z.literal('fresh-worker-per-unit'), z.literal('reuse') ]).nullable()
    })
    .readonly();

const observationSchema = z
    .strictObject({
        durationMilliseconds: z.number().check(z.nonnegative()),
        metadata: metadataSchema,
        observedAt: z.iso.datetime({ offset: true })
    })
    .readonly();

const entrySchema = z
    .strictObject({
        observations: z.array(observationSchema).readonly(),
        work: workIdSchema
    })
    .readonly();

const indexSchema = z
    .strictObject({
        entries: z.array(entrySchema).readonly(),
        updatedAt: z.iso.datetime({ offset: true }),
        version: z.literal(indexVersion)
    })
    .readonly();

function durationHistoryFilePath(projectRoot: string, runtimeStateDir: string): string {
    return path.join(
        path.isAbsolute(runtimeStateDir) ? runtimeStateDir : path.join(projectRoot, runtimeStateDir),
        ...durationHistoryPathParts
    );
}

function runtimeStateError(message: string, cause: unknown): RunCollectionError {
    const error = new RunCollectionError(message, { cause }, 'runtime-state');

    return error;
}

function durationHistoryWriteError(cause: unknown): RunnerError {
    return {
        attributedTo: null,
        cause,
        message: 'Failed to write duration history.',
        subtype: 'runtime-state'
    };
}

function parseJson(content: string, filePath: string): unknown {
    try {
        return JSON.parse(content) as unknown;
    } catch (error: unknown) {
        throw runtimeStateError(`Failed to parse duration history at ${filePath}.`, error);
    }
}

function parseDurationHistoryIndex(content: string, filePath: string): DurationHistoryIndex {
    const parsed = parseJson(content, filePath);

    const result = indexSchema.safeParse(parsed);

    if (!result.success) {
        throw runtimeStateError(`Duration history at ${filePath} has an unsupported shape.`, result.error);
    }

    return result.data;
}

async function readDurationHistoryContent(
    store: DurationHistoryStore,
    filePath: string
): Promise<string | null> {
    try {
        return await store.read(filePath);
    } catch (error: unknown) {
        throw runtimeStateError(`Failed to read duration history at ${filePath}.`, error);
    }
}

export async function readDurationHistoryIndex(
    store: DurationHistoryStore,
    projectRoot: string,
    runtimeStateDir: string
): Promise<DurationHistoryIndex | null> {
    const filePath = durationHistoryFilePath(projectRoot, runtimeStateDir);
    const content = await readDurationHistoryContent(store, filePath);

    return content === null ? null : parseDurationHistoryIndex(content, filePath);
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }

    return `{${
        Object
            .keys(value)
            .toSorted(function compareKey(left, right) {
                return left.localeCompare(right);
            })
            .map(function toEntry(key) {
                return `${JSON.stringify(key)}:${stableJson(Reflect.get(value, key))}`;
            })
            .join(',')
    }}`;
}

const workIdentityKey: (work: WorkId) => string = stableJson;

function finiteDuration(durationMilliseconds: number): boolean {
    return Number.isFinite(durationMilliseconds) && durationMilliseconds >= 0;
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
            finiteDuration(observation.durationMilliseconds);
    };
}

function sortedRecentObservations(
    observations: readonly DurationHistoryObservation[]
): readonly DurationHistoryObservation[] {
    return observations
        .toSorted(function compareObservedAt(left, right) {
            const difference = observedAtMilliseconds(right) - observedAtMilliseconds(left);

            return difference === 0
                ? left.durationMilliseconds - right.durationMilliseconds
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
        durationMilliseconds: median(observations.map(function toDuration(observation) {
            return observation.durationMilliseconds;
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
        return sample.durationMilliseconds;
    }));
    const durationByWorkKey = new Map(matchedSamples.map(function toEntry(sample) {
        return [ workIdentityKey(sample.work), sample.durationMilliseconds ];
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

function executionMetadata(resolvedRun: ResolvedRun): DurationHistoryObservationMetadata {
    const { execution } = resolvedRun.facts;

    return {
        processModel: execution.processModel,
        profile: execution.profile,
        scheduling: execution.scheduling,
        testFamily: execution.testFamily,
        workerLifecycle: execution.processModel === 'worker-pool'
            ? execution.workerLifecycle
            : null
    };
}

function durationHistoryObservationsFromResult(
    resolvedRun: ResolvedRun,
    result: DurationHistoryResult,
    observedAt: string
): readonly DurationHistoryEntry[] {
    const metadata = executionMetadata(resolvedRun);

    return result.perTest.flatMap(function toObservation(testResult) {
        if (!finiteDuration(testResult.wallTimeMs)) {
            return [];
        }

        return [ {
            observations: [ {
                durationMilliseconds: testResult.wallTimeMs,
                metadata,
                observedAt
            } ],
            work: testResult.workId
        } ];
    });
}

function entriesByWorkKey(entries: readonly DurationHistoryEntry[]): ReadonlyMap<string, DurationHistoryEntry> {
    return new Map(entries.map(function toEntry(entry) {
        return [ workIdentityKey(entry.work), entry ];
    }));
}

export function mergeDurationHistoryIndex(
    index: DurationHistoryIndex | null,
    observations: readonly DurationHistoryEntry[],
    updatedAt: string
): DurationHistoryIndex {
    const entries = new Map(entriesByWorkKey(index?.entries ?? []));

    for (const observationEntry of observations) {
        const key = workIdentityKey(observationEntry.work);
        const existing = entries.get(key);

        entries.set(key, {
            observations: sortedRecentObservations([
                ...observationEntry.observations,
                ...existing?.observations ?? []
            ]),
            work: observationEntry.work
        });
    }

    return {
        entries: Array.from(entries.values()).toSorted(function compareEntry(left, right) {
            return workIdentityKey(left.work).localeCompare(workIdentityKey(right.work));
        }),
        updatedAt,
        version: indexVersion
    };
}

function serializeDurationHistoryIndex(index: DurationHistoryIndex): string {
    return `${JSON.stringify(index, null, evenSampleDivisor)}\n`;
}

async function writeDurationHistoryIndex(
    store: DurationHistoryStore,
    resolvedRun: ResolvedRun,
    index: DurationHistoryIndex
): Promise<void> {
    await store.write(
        durationHistoryFilePath(
            resolvedRun.facts.environment.projectRoot,
            resolvedRun.facts.environment.runtimeStateDir
        ),
        serializeDurationHistoryIndex(index)
    );
}

export async function resultWithUpdatedDurationHistory(
    store: DurationHistoryStore,
    resolvedRun: ResolvedRun,
    result: RunResult,
    completedAtMilliseconds: number
): Promise<RunResult> {
    const observedAt = isoTimestamp(completedAtMilliseconds);
    const observations = durationHistoryObservationsFromResult(resolvedRun, result, observedAt);

    if (observations.length === 0) {
        return result;
    }

    try {
        const currentIndex = await readDurationHistoryIndex(
            store,
            resolvedRun.facts.environment.projectRoot,
            resolvedRun.facts.environment.runtimeStateDir
        );
        const nextIndex = mergeDurationHistoryIndex(currentIndex, observations, observedAt);

        await writeDurationHistoryIndex(store, resolvedRun, nextIndex);

        return result;
    } catch (error: unknown) {
        return {
            ...result,
            runnerErrors: [ ...result.runnerErrors, durationHistoryWriteError(error) ]
        };
    }
}
