import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
    createPlainOutputRenderer,
    createSuite,
    createTestCase,
    type CoverageArtifact,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import { generateCoverageReports } from '../../run/coverage-reporting.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import type {
    RunConfig,
    RunMicrotestProcessModel,
    RunRequest
} from '../../run/run-types.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { loadCoverageFixtures } from './fixtures/coverage-files.ts';

const coverageFixturePath = 'source/integration-tests/run/fixtures/coverage.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';

function coverageConfig(processModel: RunMicrotestProcessModel, hardTimeoutMilliseconds: number): RunConfig {
    return {
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: createPlainOutputRenderer(),
        profiles: {
            microtest: {
                execution: { maxConcurrency: 5, processModel, scheduling: 'concurrent' },
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

async function assertCoverageRun(
    scope: TestScope,
    processModel: RunMicrotestProcessModel
): Promise<CoverageArtifact> {
    const result = await orchestrator.run({
        config: coverageConfig(processModel, 10_000),
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

    return artifact;
}

async function latestCrashRawDirectory(): Promise<string> {
    const runDirectories = await readdir('target/coverage-crash-integration/runs');
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

async function assertCrashedCoverageRun(scope: TestScope): Promise<void> {
    const result = await orchestrator.run({
        config: {
            ...coverageConfig('supervised-process', 100),
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
    const rawDirectoryStat = await stat(await latestCrashRawDirectory());

    scope.assert.equal(result.status, 'failed');
    scope.assert.equal(result.summary.crashed, 1);
    scope.assert.equal(coverageArtifacts.length, 0);
    scope.assert.equal(rawDirectoryStat.isDirectory(), true);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-coverage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'in-process microtests emit native coverage artifacts',
            annotations: {},
            controls: {},
            async body(scope) {
                await assertCoverageRun(scope, 'in-process');

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
                await assertCoverageRun(scope, 'supervised-process');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'all-files reporting includes unloaded runtime source and omits type-only modules',
            annotations: {},
            controls: {},
            async body(scope) {
                const artifact = await assertCoverageRun(scope, 'in-process');
                const coverageDirectory = path.join(path.resolve(artifact.payload.directory), 'all-files');

                await generateCoverageReports({
                    coverageDirectory,
                    projectRoot: process.cwd(),
                    rawDataDirectory: path.resolve(artifact.payload.rawDataDirectory),
                    sourceScope: {
                        exclude: [ '**/*.test.ts' ],
                        excludedFiles: new Set([ path.resolve(coverageFixturePath) ]),
                        include: [ 'source/integration-tests/run/fixtures/coverage-*.ts' ],
                        kind: 'all'
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
