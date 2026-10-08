import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RunFacts, NormalizedConfig } from '../packages/run/run.entry-point.ts';
import { selectTestProfile } from '../run/test-profile.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RecordedCoverageRequest } from '../run/recorded-coverage-types.ts';
import { createRunFacts } from '../run/run-facts.ts';

import { defaultRunRequest } from './run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';

const recordSnapshotSchema = z.object({
    coverage: z.object({ directory: z.string(), rawDataDirectory: z.string() }).nullable(),
    facts: z.unknown(),
    result: z
        .object({
            artifacts: z.array(z.unknown()),
            runnerErrors: z.array(z.unknown()),
            status: z.enum([ 'failed', 'passed' ])
        })
        .nullable(),
    status: z.enum([ 'completed', 'interrupted', 'started' ])
});
type RecordSnapshot = Readonly<z.infer<typeof recordSnapshotSchema>>;

export type CoverageRecordFixture = {
    readonly cleanup: () => Promise<void>;
    readonly facts: RunFacts;
    readonly records: readonly RecordSnapshot[];
    readonly request: Pick<RecordedCoverageRequest, 'command' | 'dependencies' | 'input' | 'timing'>;
};

function discardOutput(): void {
    return undefined;
}

function coverageFixtureDependencies(): RecordedCoverageRequest['dependencies'] {
    const dependencies = fakeWorkerPoolRuntimeDependencies();
    const environment = {};
    return {
        ...dependencies,
        runtimeCapabilityPolicy: {
            ...dependencies.runtimeCapabilityPolicy,
            readEnvironment() {
                return environment;
            }
        }
    };
}

async function createCoverageRecordFixture(
    config: NormalizedConfig,
    failedWrites: readonly number[]
): Promise<CoverageRecordFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/coverage-record-');
    const dependencies = coverageFixtureDependencies();
    const records: RecordSnapshot[] = [];
    let writes = 0;
    const input = {
        config: { ...config, runtimeStateDir: directory },
        engine: { kind: 'default' as const },
        files: [ { file: 'fixture.ts', fileSet: null, href: 'file:///fixture.ts', path: '/fixture.ts' } ] as const,
        profile: selectTestProfile('microtest', config),
        projectRoot: process.cwd(),
        request: defaultRunRequest({ coverage: true })
    };

    const request = {
        command: { config: input.config, cwd: process.cwd(), engine: input.engine, request: input.request },
        dependencies: {
            ...dependencies,
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: discardOutput },
                stdout: { writeLine: discardOutput },
                wallClock: dependencies.wallClock
            }),
            runtimeStateStore: {
                ...dependencies.runtimeStateStore,
                async write(filePath: string, content: string) {
                    if (path.basename(path.dirname(filePath)) !== 'runs') {
                        return;
                    }
                    writes += 1;
                    if (failedWrites.includes(writes)) {
                        throw new Error(`Cannot write ${filePath}`);
                    }
                    records.push(recordSnapshotSchema.parse(JSON.parse(content)));
                }
            }
        },
        input: { ...input, profile: input.profile },
        timing: null
    };

    return {
        async cleanup() {
            await rm(path.resolve(directory), { force: true, recursive: true });
        },
        facts: createRunFacts({
            cases: [],
            config: input.config,
            dependencies,
            durationHistory: null,
            engine: input.engine,
            placementPlan: null,
            projectRoot: input.projectRoot,
            request: input.request,
            scheduling: input.profile.execution.scheduling,
            workerCount: null
        }),
        records,
        request
    };
}

export async function withCoverageRecordFixture<Value>(
    config: NormalizedConfig,
    failedWrites: readonly number[],
    work: (fixture: CoverageRecordFixture) => Promise<Value>
): Promise<Value> {
    const fixture = await createCoverageRecordFixture(config, failedWrites);
    try {
        return await work(fixture);
    } finally {
        await fixture.cleanup();
    }
}
