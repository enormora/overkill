import { createDeterministicClock } from '@enormora/clock';
import { z } from 'zod';
import { createRunFacts } from '../run/run-facts.ts';
import { createRunRecordSession, type RunRecordSession } from '../run/run-record.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';
import { createMemoryHistoryStorage } from './memory-history-storage.ts';

const fixtureSeed = 42n;
export const recordId = '01K00000000000000000000000';
export const profile = defaultMicrotestProfile({ execution: { processModel: 'in-process', scheduling: 'serial' } });
const input = {
    config: defaultRunConfig({ profiles: { microtest: profile }, runtimeStateDir: 'state' }),
    engine: { kind: 'default' as const },
    files: [ { file: 'test.ts', fileSet: null, href: 'file:///project/test.ts', path: '/project/test.ts' } ] as const,
    profile,
    projectRoot: '/project',
    request: defaultRunRequest({ coverage: true })
};
const node = { arch: 'x64', platform: 'linux', version: '26.10.0' };
export const facts = createRunFacts({
    hostProcess: null,
    benchmarkHost: null,
    benchmarkCalibration: null,
    benchmarkNormalization: null,
    benchmarkPlacement: null,
    selectedIdentities: [],
    cases: [],
    config: input.config,
    dependencies: {
        createSeed() {
            return fixtureSeed;
        },
        node
    },
    durationHistory: null,
    engine: input.engine,
    placementPlan: null,
    projectRoot: input.projectRoot,
    request: input.request,
    scheduling: 'serial',
    workerCount: null
});

const snapshotSchema = z
    .looseObject({
        status: z.string(),
        startedAt: z.string(),
        facts: z.unknown(),
        runtime: z.unknown(),
        execution: z.unknown(),
        request: z.looseObject({ seed: z.object({ value: z.string() }) }),
        versions: z.looseObject({ engine: z.string().nullable() }),
        result: z
            .looseObject({
                status: z.string(),
                summary: z.looseObject({ passed: z.number() }),
                runnerErrors: z.array(z.looseObject({ message: z.string(), cause: z.unknown() }))
            })
            .nullable()
    })
    .readonly();
export type RecordSessionSnapshot = z.output<typeof snapshotSchema>;

type RecordFixture = { readonly session: RunRecordSession; readonly writes: readonly RecordSessionSnapshot[]; };

export function recordFixtureWithStorageProbe(
    failedWrites: readonly number[],
    probe: () => Promise<void> | void
): RecordFixture {
    const writes: RecordSessionSnapshot[] = [];
    let attempts = 0;
    const session = createRunRecordSession('/project/subdirectory', input, {
        history: createMemoryHistoryStorage(),
        async maintainHistory() {
            return [];
        },
        createId() {
            return recordId;
        },
        node,
        store: {
            async write(filePath, content) {
                await probe();
                attempts += 1;
                if (failedWrites.includes(attempts)) {
                    throw new Error(`Cannot write ${filePath}`);
                }
                const parsed: unknown = JSON.parse(content);
                writes.push(snapshotSchema.parse(parsed));
            }
        },
        versions: { engine: null, node: node.version, packages: { reporter: '1.2.3' } },
        wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
    });

    return { session, writes };
}

export function recordFixture(failedWrites: readonly number[]): RecordFixture {
    return recordFixtureWithStorageProbe(failedWrites, function noStorageProbe() {
        return undefined;
    });
}

export function recordUnresolvedSeed(): void {
    createRunRecordSession('/project', { ...input, request: { ...input.request, seed: { value: null } } }, {
        history: createMemoryHistoryStorage(),
        async maintainHistory() {
            return [];
        },
        createId() {
            return recordId;
        },
        node,
        store: {
            async write() {
                return undefined;
            }
        },
        versions: { engine: null, node: node.version, packages: {} },
        wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
    });
}
