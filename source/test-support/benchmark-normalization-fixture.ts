import { mkdtemp, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { TestScope } from '@overkill-dev/test';
import { createPerformanceBaselineStore, type PerformanceBaselineStore } from '../baselines/performance-store.ts';
import { createNullReporter } from '../reporters/null-reporter.ts';
import { normalizeConfig, type RunCommand } from '../packages/run/run.entry-point.ts';
import { createCalibrationReferenceStore, type CalibrationReferenceStore } from '../baselines/calibration-store.ts';
import { normalizationBaselineAdapter } from './normalization-baseline-adapter.ts';
import { defaultRunRequest } from './run-command-factory.ts';

const replacementCalibrationSample = 400;
const fixture = 'source/integration-tests/runtime/fixtures/normalization.bench.test.ts';
export type Boundary = 'fresh-worker-per-unit' | 'reuse' | 'supervised-process';
export async function normalizationCommand(
    cleanup: TestScope['cleanup'],
    boundary: Boundary,
    title: string
): Promise<RunCommand> {
    const directory = await mkdtemp(join(process.cwd(), 'target/normalization-'));
    cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    return {
        config: normalizeConfig({
            runtimeStateDir: join(directory, 'state'),
            reporters: [ createNullReporter() ],
            profiles: {
                bench: {
                    testFamily: 'benchmark',
                    timeouts: { collectionMilliseconds: 30_000 },
                    baselines: { directory: relative(process.cwd(), directory), adapters: [] },
                    files: { include: [ fixture ] },
                    execution: boundary === 'supervised-process'
                        ? { processModel: 'supervised-process' }
                        : { processModel: 'worker-pool', workerLifecycle: boundary }
                }
            }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'bench',
            selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: title } }
        })
    };
}
export async function normalizationReferences(command: RunCommand): Promise<CalibrationReferenceStore> {
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return await createCalibrationReferenceStore({
        projectRoot: process.cwd(),
        directory: profile.baselines.directory,
        maxBytes: profile.attachments.maxArtifactBytes
    });
}

export function withBaselineAdapters(command: RunCommand, adapters: readonly string[]): RunCommand {
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return {
        ...command,
        config: {
            ...command.config,
            profiles: {
                ...command
                    .config
                    .profiles,
                bench: {
                    ...profile,
                    baselines: { ...profile.baselines, adapters: adapters.map(normalizationBaselineAdapter) }
                }
            }
        }
    };
}

export async function baselineCommand(cleanup: TestScope['cleanup'], adapters: readonly string[]): Promise<RunCommand> {
    return withBaselineAdapters(await normalizationCommand(cleanup, 'reuse', 'normalized metric'), adapters);
}

async function performanceStore(command: RunCommand): Promise<PerformanceBaselineStore> {
    const profile = command.config.profiles.bench;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return await createPerformanceBaselineStore({
        directory: profile.baselines.directory,
        projectRoot: command.cwd,
        maxBytes: profile.attachments.maxArtifactBytes
    });
}

export async function replaceSavedCalibration(
    command: RunCommand,
    component: 'actual' | 'reference'
): Promise<void> {
    const store = await performanceStore(command);
    const entries = await store.list();
    const baseline = entries[0]?.baseline;
    if (baseline === undefined) {
        throw new Error('Expected a saved baseline.');
    }
    const normalization = baseline.normalization;
    const metric = normalization?.metrics.value;
    if (normalization === null || metric === undefined) {
        throw new Error('Expected a saved normalization metric.');
    }
    await store.apply({
        kind: 'update',
        previous: baseline,
        baseline: {
            ...baseline,
            normalization: {
                ...normalization,
                metrics: {
                    ...normalization.metrics,
                    value: {
                        ...metric,
                        [component]: {
                            ...metric[component],
                            samples: metric[component]
                                .samples
                                .map(function savedSample() {
                                    return replacementCalibrationSample;
                                })
                        }
                    }
                }
            }
        }
    });
}
