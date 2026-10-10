import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { posix as path } from 'node:path';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import {
    normalizeConfig,
    orchestrator,
    type RunCommand,
    type BenchmarkExecution
} from '../packages/run/run.entry-point.ts';
import type { PerformanceBaselineAdapter } from '../baselines/performance-adapter.ts';
import { defaultRunRequest } from './run-command-factory.ts';

export const performanceBaselineFixtureFile =
    'source/integration-tests/run/fixtures/performance-baselines.bench.test.ts';
const fixture = performanceBaselineFixtureFile;
export type BaselineFixture = {
    readonly command: RunCommand;
    readonly directory: string;
    readonly setOffset: (offset: number) => void;
};

export function durationAdapter(readOffset: () => number): PerformanceBaselineAdapter {
    return {
        id: 'duration',
        observe({ artifacts }) {
            for (const artifact of artifacts) {
                const { payload } = artifact;
                if (payload.kind === 'runtime-attachment' && payload.name === 'duration') {
                    const { content } = payload;
                    if (content.kind === 'json' && typeof content.value === 'number') {
                        return { kind: 'observed', value: content.value + readOffset() };
                    }
                }
            }
            return { kind: 'missing', reason: 'Duration observation missing.' };
        },
        propose({ actual }) {
            return actual.value;
        },
        compare({ actual, expected }) {
            return actual.value === expected.value
                ? { kind: 'match' }
                : {
                    kind: 'mismatch',
                    diagnostics: [ { actual: actual.value, expected: expected.value, summary: 'Duration changed.' } ]
                };
        }
    };
}

export async function createBenchmarkBaselineFixture(
    scope: TestScope,
    execution: BenchmarkExecution
): Promise<BaselineFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/performance-baselines-');
    scope.cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    let offset = 0;
    const config = normalizeConfig({
        runtimeStateDir: path.join(directory, 'runtime'),
        profiles: {
            startup: {
                testFamily: 'benchmark',
                files: { include: [ fixture ] },
                baselines: {
                    directory: path.join(directory, 'baselines'),
                    adapters: [ durationAdapter(function () {
                        return offset;
                    }) ]
                }
            }
        }
    });
    const profile = config.profiles.startup;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    const configured = { ...config, reporters: [], profiles: { startup: { ...profile, execution } } };
    return {
        directory,
        setOffset(value) {
            offset = value;
        },
        command: {
            config: configured,
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({ profile: 'startup' })
        }
    };
}

export async function readBaselineContents(fixtureData: BaselineFixture): Promise<readonly string[]> {
    const entries = await orchestrator.bench.baseline.list({
        ...fixtureData.command,
        request: { paths: [], profile: 'startup' }
    });
    return await Promise.all(entries.map(async function readEntry(entry) {
        return await readFile(entry.path, 'utf8');
    }));
}
