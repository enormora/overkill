import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
    createPlainOutputRenderer,
    createSuite,
    createTestCase,
    type CoverageArtifact,
    type CoverageRunnerError,
    type RunResult,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { orchestrator, type RunRecord } from '../../packages/run/run.entry-point.ts';
import { generateCoverageReports } from '../../run/coverage-reporting.ts';
import { defaultCoveragePolicy } from '../../run/run-config-defaults.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import type {
    RunCoveragePolicy,
    RunConfig,
    RunMicrotestProcessModel,
    RunScheduling,
    RunRequest
} from '../../run/run-types.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { loadCoverageFixtures } from './fixtures/coverage-files.ts';

const coverageFixturePath = 'source/integration-tests/run/fixtures/coverage.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';

function coverageConfig(
    processModel: RunMicrotestProcessModel,
    hardTimeoutMilliseconds: number,
    coverage: RunCoveragePolicy,
    scheduling: RunScheduling
): RunConfig {
    return {
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: createPlainOutputRenderer(),
        profiles: {
            microtest: {
                coverage,
                execution: { maxConcurrency: 5, processModel, scheduling },
                files: null,
                reporters: null,
                resourceUsage: {
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: false,
                    samplingIntervalMilliseconds: 100
                },
                testFamily: 'microtest',
                timings: { collection: 'summary' },
                timeouts: {
                    collectionMilliseconds: 10_000,
                    hardMilliseconds: hardTimeoutMilliseconds,
                    softMilliseconds: Math.min(5000, hardTimeoutMilliseconds)
                }
            }
        },
        reporters: [],
        runtimeStateDir: 'target/coverage-integration'
    };
}

function coverageRequest(): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        coverage: true,
        debug: { mode: 'off', selectors: [] },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'plan',
        paths: [ coverageFixturePath ],
        profile: 'microtest',
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: 42n },
        selection: { kind: 'all' },
        shard: { index: 1, total: 1 },
        timingCollection: 'profile-default',
        verbose: false,
        workers: null
    };
}

function coverageArtifact(scope: TestScope, artifacts: readonly CoverageArtifact[]): CoverageArtifact {
    const [ artifact ] = artifacts;

    scope.require.defined(artifact);

    return artifact;
}

function reportPath(artifact: CoverageArtifact, format: 'lcov' | 'v8'): string {
    return path.resolve(
        artifact
            .payload
            .reports
            .find(function matchesFormat(report) {
                return report.format === format;
            })
            ?.path ?? `missing-${format}`
    );
}

async function assertCoverageFiles(scope: TestScope, artifact: CoverageArtifact): Promise<void> {
    const coverageDirectory = path.resolve(artifact.payload.directory);
    const lcovPath = reportPath(artifact, 'lcov');
    const v8Path = reportPath(artifact, 'v8');
    const [ lcov, coverageDirectoryStat, v8Stat, rawFiles ] = await Promise.all([
        readFile(lcovPath, 'utf8'),
        stat(coverageDirectory),
        stat(v8Path),
        readdir(path.resolve(artifact.payload.rawDataDirectory))
    ]);

    scope.assert.equal(artifact.payload.completeness, 'complete');
    scope.assert.equal(coverageDirectoryStat.isDirectory(), true);
    scope.assert.equal(v8Stat.isFile(), true);
    scope.assert.true(rawFiles.length > 0);
    scope.assert.true(lcov.includes('coverage-source.ts'));
    scope.assert.false(lcov.includes('coverage.test.ts'));
}

type CoverageExecution = { readonly processModel: RunMicrotestProcessModel; readonly scheduling: RunScheduling; };

async function assertCoverageRecord(
    scope: TestScope,
    artifact: CoverageArtifact,
    result: RunResult,
    execution: CoverageExecution
): Promise<void> {
    const recordPath = `${path.dirname(path.resolve(artifact.payload.directory))}.json`;
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as RunRecord;
    scope.require.defined(record.facts);
    scope.assert.deepEqual({
        coverage: record.request.coverage,
        id: record.id,
        maxConcurrency: record.facts.execution.maxConcurrency,
        processModel: record.facts.execution.processModel,
        scheduling: record.facts.execution.scheduling,
        seed: record.request.seed,
        status: record.status
    }, {
        coverage: true,
        id: path.basename(recordPath, '.json'),
        maxConcurrency: 5,
        ...execution,
        seed: { value: '42' },
        status: 'completed'
    });
    scope.assert.deepEqual<unknown, unknown>(record.coverage?.policy, defaultCoveragePolicy);
    scope.assert.equal(record.coverage?.directory, artifact.payload.directory);
    scope.assert.equal(record.coverage?.rawDataDirectory, artifact.payload.rawDataDirectory);
    scope.assert.deepEqual(
        record.identities,
        result.perTest.map(function workIdentity(test) {
            return test.workId;
        })
    );
    scope.assert.deepEqual<unknown, unknown>(record.result?.artifacts, result.artifacts);
    scope.assert.equal(record.result?.status, result.status);
}

async function assertCoverageRun(
    scope: TestScope,
    processModel: RunMicrotestProcessModel,
    scheduling: RunScheduling
): Promise<CoverageArtifact> {
    const result = await orchestrator.run({
        config: coverageConfig(processModel, 10_000, defaultCoveragePolicy, scheduling),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: coverageRequest()
    });
    const artifacts = result.artifacts.filter(function isCoverageArtifact(
        artifact
    ): artifact is CoverageArtifact {
        return artifact.payload.kind === 'coverage';
    });

    scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
    const artifact = coverageArtifact(scope, artifacts);

    await assertCoverageFiles(scope, artifact);
    await assertCoverageRecord(scope, artifact, result, { processModel, scheduling });

    return artifact;
}

async function assertNoCoverageState(scope: TestScope): Promise<void> {
    const config = {
        ...coverageConfig('in-process', 10_000, defaultCoveragePolicy, 'serial'),
        runtimeStateDir: 'target/coverage-disabled-integration'
    };
    const command = { config, cwd: process.cwd(), engine: { kind: 'default' as const }, request: coverageRequest() };
    const resolved = await orchestrator.resolve(command);
    scope.assert.deepEqual<unknown, unknown>(resolved.facts.coveragePolicy, defaultCoveragePolicy);
    await scope.assert.rejects(async function readResolveState() {
        await stat(path.join(config.runtimeStateDir, 'runs'));
    }, { code: 'ENOENT' });
    const result = await orchestrator.run({ ...command, request: { ...command.request, coverage: false } });
    scope.assert.equal(result.status, 'passed');
    await scope.assert.rejects(async function readOrdinaryState() {
        await stat(path.join(config.runtimeStateDir, 'runs'));
    }, { code: 'ENOENT' });
}

async function latestCrashRawDirectory(): Promise<string> {
    const entries = await readdir('target/coverage-crash-integration/runs', { withFileTypes: true });
    const runDirectories = entries
        .filter(function isDirectory(entry) {
            return entry.isDirectory();
        })
        .map(function directoryName(entry) {
            return entry.name;
        });
    const latestRunDirectory = runDirectories
        .toSorted(function orderRunDirectories(first, second) {
            return first.localeCompare(second);
        })
        .at(-1);

    if (latestRunDirectory === undefined) {
        throw new Error('Coverage run directory was not created.');
    }

    return path.join('target/coverage-crash-integration/runs', latestRunDirectory, 'coverage/raw');
}

async function assertCompletedCrashRecord(scope: TestScope, rawDirectory: string): Promise<void> {
    const recordPath = `${path.resolve(rawDirectory, '../..')}.json`;
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as RunRecord;
    scope.assert.equal(record.status, 'completed');
    scope.assert.equal(record.result?.status, 'failed');
    scope.assert.equal(record.result?.summary.crashed, 1);
    scope.assert.deepEqual<unknown, unknown>(record.result?.artifacts, []);
    scope.assert.equal(path.resolve(record.coverage?.rawDataDirectory ?? 'missing'), path.resolve(rawDirectory));
}

async function assertCrashedCoverageRun(scope: TestScope): Promise<void> {
    const result = await orchestrator.run({
        config: {
            ...coverageConfig('supervised-process', 100, defaultCoveragePolicy, 'concurrent'),
            runtimeStateDir: 'target/coverage-crash-integration'
        },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: {
            ...coverageRequest(),
            paths: [ endlessLoopFixturePath ]
        }
    });
    const coverageArtifacts = result.artifacts.filter(function isCoverageArtifact(artifact) {
        return artifact.payload.kind === 'coverage';
    });
    const rawDirectory = await latestCrashRawDirectory();
    const rawDirectoryStat = await stat(rawDirectory);
    await assertCompletedCrashRecord(scope, rawDirectory);

    scope.assert.equal(result.status, 'failed');
    scope.assert.equal(result.summary.crashed, 1);
    scope.assert.equal(coverageArtifacts.length, 0);
    scope.assert.equal(rawDirectoryStat.isDirectory(), true);
}

async function assertCoverageThresholdFailure(scope: TestScope): Promise<void> {
    const result = await orchestrator.run({
        config: coverageConfig('in-process', 10_000, {
            ...defaultCoveragePolicy,
            thresholds: { branches: null, functions: 100, lines: null }
        }, 'concurrent'),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: coverageRequest()
    });
    const coverageError = result.runnerErrors.find(function isCoverageError(error): error is CoverageRunnerError {
        return error.subtype === 'coverage';
    });

    scope.assert.equal(result.status, 'failed');
    scope.require.defined(coverageError);
    scope.assert.equal(coverageError.cause.kind, 'coverage-threshold');
    scope.assert.equal(
        result.artifacts.some(function isCoverageArtifact(artifact) {
            return artifact.payload.kind === 'coverage';
        }),
        true
    );
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-coverage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'ordinary runs and coverage resolution create no run records',
            annotations: {},
            controls: {},
            async body(scope) {
                await assertNoCoverageState(scope);
                return scope.assert.collect();
            }
        }),
        ...[ 'in-process', 'supervised-process' ].map(function serialCoverageTest(processModel) {
            return createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${processModel} serial coverage preserves scheduling in its record`,
                annotations: {},
                controls: {},
                async body(scope) {
                    await assertCoverageRun(
                        scope,
                        processModel === 'in-process' ? 'in-process' : 'supervised-process',
                        'serial'
                    );
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage threshold misses fail the run and retain the artifact',
            annotations: {},
            controls: {},
            async body(scope) {
                await assertCoverageThresholdFailure(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'in-process microtests emit native coverage artifacts',
            annotations: {},
            controls: {},
            async body(scope) {
                await assertCoverageRun(scope, 'in-process', 'concurrent');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'crashed supervised runs retain raw storage without publishing a coverage artifact',
            annotations: {},
            controls: {},
            async body(scope) {
                await assertCrashedCoverageRun(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'supervised microtests emit native coverage artifacts',
            annotations: {},
            controls: {},
            async body(scope) {
                await assertCoverageRun(scope, 'supervised-process', 'concurrent');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'all-files reporting includes unloaded runtime source and omits type-only modules',
            annotations: {},
            controls: {},
            async body(scope) {
                const artifact = await assertCoverageRun(scope, 'in-process', 'concurrent');
                const coverageDirectory = path.join(path.resolve(artifact.payload.directory), 'all-files');

                await generateCoverageReports({
                    coverageDirectory,
                    outputs: [ 'lcov' ],
                    projectRoot: process.cwd(),
                    rawDataDirectory: path.resolve(artifact.payload.rawDataDirectory),
                    sourceScope: {
                        exclude: [ '**/*.test.ts' ],
                        excludedFiles: new Set([ path.resolve(coverageFixturePath) ]),
                        include: [ 'source/integration-tests/run/fixtures/coverage-*.ts' ],
                        mode: 'all'
                    }
                });

                const lcov = await readFile(path.join(coverageDirectory, 'lcov.info'), 'utf8');

                scope.assert.true(lcov.includes('coverage-unloaded.ts'));
                scope.assert.false(lcov.includes('coverage-types.ts'));
                await loadCoverageFixtures();

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
