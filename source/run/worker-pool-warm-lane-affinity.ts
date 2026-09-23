import { posix as path } from 'node:path';
import { runtimeIdentitiesKey, type WorkloadId } from '../engine/identity.ts';
import type { PlacementLane, WorkUnit } from './run-types.ts';

export type WarmLaneAffinityKeyKind = 'affinity' | 'directory' | 'file' | 'runtime-workload';

export type WarmLaneAffinityMatch = {
    readonly kinds: readonly WarmLaneAffinityKeyKind[];
    readonly score: number;
};

export type WarmLaneAffinity = {
    readonly clear: (lane: PlacementLane) => void;
    readonly learn: (lane: PlacementLane, units: readonly WorkUnit[]) => void;
    readonly match: (lane: PlacementLane, unit: WorkUnit) => WarmLaneAffinityMatch;
};

type WarmLaneKey = {
    readonly id: string;
    readonly kind: WarmLaneAffinityKeyKind;
    readonly weight: number;
};

type CountedWarmLaneKey = {
    readonly count: number;
    readonly kind: WarmLaneAffinityKeyKind;
    readonly weight: number;
};

type LaneWarmth = {
    readonly keys: ReadonlyMap<string, CountedWarmLaneKey>;
    readonly records: readonly (readonly WarmLaneKey[])[];
};

const retainedWarmUnitCount = 32;
const warmKeyWeights: Readonly<Record<WarmLaneAffinityKeyKind, number>> = {
    affinity: 2,
    directory: 4,
    file: 16,
    'runtime-workload': 1
};

function orderedRecordEntries(record: Readonly<Record<string, string>>): readonly [string, string][] {
    return Object.entries(record).toSorted(function compareKeys([ left ], [ right ]) {
        return left.localeCompare(right);
    });
}

function workloadIdentityKey(workload: WorkloadId | null): string {
    return workload === null
        ? 'null'
        : JSON.stringify([ workload.name, orderedRecordEntries(workload.params) ]);
}

function warmKey(kind: WarmLaneAffinityKeyKind, value: string): WarmLaneKey {
    return {
        id: JSON.stringify([ kind, value ]),
        kind,
        weight: warmKeyWeights[kind]
    };
}

function uniqueWarmKeys(keys: readonly WarmLaneKey[]): readonly WarmLaneKey[] {
    const keysById = new Map(keys.map(function toEntry(key) {
        return [ key.id, key ];
    }));

    return Array.from(keysById.values());
}

function fileWarmKeys(unit: WorkUnit): readonly WarmLaneKey[] {
    return unit.work.flatMap(function toFileKeys(work) {
        const { file } = work.case;

        if (file === null) {
            return [];
        }

        const directory = path.dirname(file);
        const directoryKeys = directory === '.' || directory === ''
            ? []
            : [ warmKey('directory', directory) ];

        return [ warmKey('file', file), ...directoryKeys ];
    });
}

function runtimeWorkloadWarmKey(unit: WorkUnit): WarmLaneKey {
    return warmKey(
        'runtime-workload',
        JSON.stringify([ runtimeIdentitiesKey(unit.id.runtimes), workloadIdentityKey(unit.id.workload) ])
    );
}

function warmKeys(unit: WorkUnit): readonly WarmLaneKey[] {
    if (unit.workerLifecycle !== 'reuse') {
        return [];
    }

    return uniqueWarmKeys([
        ...fileWarmKeys(unit),
        ...unit.resourceConstraints.affinityKeys.map(function toAffinityKey(key) {
            return warmKey('affinity', key);
        }),
        runtimeWorkloadWarmKey(unit)
    ]);
}

function incrementWarmKey(
    keys: ReadonlyMap<string, CountedWarmLaneKey>,
    key: WarmLaneKey
): ReadonlyMap<string, CountedWarmLaneKey> {
    const nextKeys = new Map(keys);
    const current = nextKeys.get(key.id);

    nextKeys.set(key.id, {
        count: (current?.count ?? 0) + 1,
        kind: key.kind,
        weight: key.weight
    });

    return nextKeys;
}

function decrementWarmKey(
    keys: ReadonlyMap<string, CountedWarmLaneKey>,
    key: WarmLaneKey
): ReadonlyMap<string, CountedWarmLaneKey> {
    const current = keys.get(key.id);

    if (current === undefined) {
        return keys;
    }

    const nextKeys = new Map(keys);

    if (current.count <= 1) {
        nextKeys.delete(key.id);

        return nextKeys;
    }

    nextKeys.set(key.id, {
        ...current,
        count: current.count - 1
    });

    return nextKeys;
}

function recordWarmKeys(lane: LaneWarmth, keys: readonly WarmLaneKey[]): LaneWarmth {
    let nextKeys = keys.reduce(incrementWarmKey, lane.keys);
    const nextRecords = [ ...lane.records, keys ];
    const expired = nextRecords.length > retainedWarmUnitCount ? nextRecords[0] : undefined;
    const records = expired === undefined ? nextRecords : nextRecords.slice(1);

    if (expired !== undefined) {
        nextKeys = expired.reduce(decrementWarmKey, nextKeys);
    }

    return { keys: nextKeys, records };
}

function emptyLaneWarmth(): LaneWarmth {
    return {
        keys: new Map(),
        records: []
    };
}

function laneKey(lane: PlacementLane): string {
    return lane.id;
}

export function createWarmLaneAffinity(): WarmLaneAffinity {
    const warmthByLane = new Map<string, LaneWarmth>();

    function laneWarmth(lane: PlacementLane): LaneWarmth {
        return warmthByLane.get(laneKey(lane)) ?? emptyLaneWarmth();
    }

    return {
        clear(lane) {
            warmthByLane.delete(laneKey(lane));
        },
        learn(lane, units) {
            let nextWarmth = laneWarmth(lane);

            for (const unit of units) {
                const keys = warmKeys(unit);

                if (keys.length > 0) {
                    nextWarmth = recordWarmKeys(nextWarmth, keys);
                }
            }

            warmthByLane.set(laneKey(lane), nextWarmth);
        },
        match(lane, unit) {
            const laneWarmKeys = laneWarmth(lane).keys;
            const matchedKeys = warmKeys(unit).flatMap(function toMatchedKey(key) {
                const matched = laneWarmKeys.get(key.id);

                return matched === undefined ? [] : [ matched ];
            });
            const kinds = Array
                .from(
                    new Set(matchedKeys.map(function toKind(key) {
                        return key.kind;
                    }))
                )
                .toSorted(function compareKind(left, right) {
                    return left.localeCompare(right);
                });

            return {
                kinds,
                score: matchedKeys.reduce(function addScore(total, key) {
                    return total + key.weight;
                }, 0)
            };
        }
    };
}
