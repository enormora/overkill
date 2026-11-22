import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { table, suite, test, type TestScope } from '@overkill-dev/test';

import {
    orchestrator,
    normalizeConfig,
    type SingleRunRecord,
    type CompactRunRecord,
    type RunRequest,
    type CoveragePolicy,
    type NormalizedConfig,
    type MicrotestExecution,
    type Scheduling
} from '../../packages/run/run.entry-point.ts';
import {
    createPlainOutputRenderer,
    type CoverageArtifact,
    type CoverageRunnerError,
    type RunResult
} from '../../packages/engine/engine.entry-point.ts';

import { generateCoverageReports } from '../../run/coverage-reporting.ts';
import { isolatedRunStateDirectory, defaultMicrotestProfile } from '../../test-support/run-command-factory.ts';
import { coverageSubject } from './support/coverage-subject.ts';
import { loadCoverageFixtures } from './fixtures/coverage-files.ts';

const defaultCoveragePolicy = defaultMicrotestProfile().coverage;

const coverageFixturePath = 'source/integration-tests/runtime/fixtures/coverage.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/runtime/fixtures/endless-loop.test.ts';

function coverageConfig(
    processModel: MicrotestExecution['processModel'],
    hardTimeoutMilliseconds: number,
    coverage: CoveragePolicy,
    scheduling: Scheduling
): NormalizedConfig {
    const config = normalizeConfig({
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: createPlainOutputRenderer(),
        profiles: {
            microtest: {
                testFamily: 'microtest',
                execution: { maxConcurrency: 5, processModel, scheduling },
                timeouts: {
                    collectionMilliseconds: 10_000,
                    hardMilliseconds: hardTimeoutMilliseconds,
                    softMilliseconds: Math.min(5000, hardTimeoutMilliseconds)
                }
            }
        },
        runtimeStateDir: isolatedRunStateDirectory()
    });
    const profile = config.profiles.microtest;
    if (profile?.testFamily !== 'microtest') {
        throw new Error('Expected a microtest coverage profile.');
    }
    return { ...config, reporters: [], profiles: { microtest: { ...profile, coverage } } };
}

function coverageRequest(): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        record: false,
        recordForMerge: false,
        lastFailed: false,
        coverage: true,
        debug: { mode: 'off', selectors: [] },
        execution: { mode: 'profile-default' },
        measureProcessUsage: null,
        order: 'plan',
        paths: [ coverageFixturePath ],
        profile: 'microtest',
        processBudgetOverrides: null,
        processUsageSamplingIntervalMilliseconds: null,
        seed: { value: 42n },
        selection: { kind: 'all' },
        shard: { index: 1, total: 1 },
        timingCollection: 'profile-default',
        verbose: false,
        workers: null
    };
}

function coverageArtifact(artifacts: readonly CoverageArtifact[]): CoverageArtifact {
    const [ artifact ] = artifacts;

    if (artifact === undefined) {
        throw new Error('Expected artifact to satisfy defined.');
    }

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

const coverageFileChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    artifact: CoverageArtifact
): Promise<CompositeAssertionReturn<'assert'>> {
    const coverageDirectory = path.resolve(artifact.payload.directory);
    const lcovPath = reportPath(artifact, 'lcov');
    const v8Path = reportPath(artifact, 'v8');
    const [ lcov, coverageDirectoryStat, v8Stat, rawFiles ] = await Promise.all([
        readFile(lcovPath, 'utf8'),
        stat(coverageDirectory),
        stat(v8Path),
        readdir(path.resolve(artifact.payload.rawDataDirectory))
    ]);
    return check.group([
        check.equal(artifact.payload.completeness, 'complete'),
        check.equal(coverageDirectoryStat.isDirectory(), true),
        check.equal(v8Stat.isFile(), true),
        check.true(rawFiles.length > 0),
        check.true(lcov.includes('coverage-source.ts')),
        check.false(lcov.includes('coverage.test.ts'))
    ]);
};

type CoverageExecution = {
    readonly processModel: MicrotestExecution['processModel'];
    readonly scheduling: Scheduling;
};

const coverageRecordChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    artifact: CoverageArtifact,
    result: RunResult,
    execution: CoverageExecution
): Promise<CompositeAssertionReturn<'assert'>> {
    const recordPath = `${path.dirname(path.resolve(artifact.payload.directory))}.json`;
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as SingleRunRecord;
    if (record.facts === null) {
        return check.notNull(record.facts);
    }
    if (record.coverage === null) {
        return check.notNull(record.coverage);
    }
    return check.group([
        check.deepEqual({
            coverage: record.request.coverage,
            record: record.request.record,
            lastFailed: record.request.lastFailed,
            id: record.id,
            maxConcurrency: record.facts.execution.maxConcurrency,
            processModel: record.facts.execution.processModel,
            scheduling: record.facts.execution.scheduling,
            seed: record.request.seed,
            status: record.status
        }, {
            record: false,
            lastFailed: false,
            coverage: true,
            id: path.basename(recordPath, '.json'),
            maxConcurrency: 5,
            ...execution,
            seed: { value: '42' },
            status: 'completed'
        }),
        check.deepEqual<unknown, unknown>(record.coverage.policy, defaultCoveragePolicy),
        check.equal(record.coverage.directory, artifact.payload.directory),
        check.equal(record.coverage.rawDataDirectory, artifact.payload.rawDataDirectory),
        check.deepEqual(
            record.identities,
            result.perTest.map(function workIdentity(testResult) {
                return testResult.workId;
            })
        ),
        check.deepEqual<unknown, unknown>(record.result?.artifacts, result.artifacts),
        check.equal(record.result?.status, result.status)
    ]);
};

type CoverageRunEvidence = CoverageExecution & { readonly artifact: CoverageArtifact; readonly result: RunResult; };
async function runCoverage(
    cleanup: TestScope['cleanup'],
    processModel: MicrotestExecution['processModel'],
    scheduling: Scheduling
): Promise<CoverageRunEvidence> {
    const directory = await mkdtemp('target/coverage-run-');
    cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    const result = await coverageSubject.run({
        config: {
            ...coverageConfig(processModel, 10_000, defaultCoveragePolicy, scheduling),
            runtimeStateDir: directory
        },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: coverageRequest()
    });
    const artifacts = result.artifacts.filter(function (artifact): artifact is CoverageArtifact {
        return artifact.payload.kind === 'coverage';
    });
    return { result, artifact: coverageArtifact(artifacts), processModel, scheduling };
}
const successfulCoverageRun = defineCompositeAssertion({
    name: 'native coverage run',
    async assert(check, run: CoverageRunEvidence) {
        return check.group([
            check.annotated(JSON.stringify(run.result.runnerErrors)).equal(run.result.status, 'passed'),
            await coverageFileChecks(check, run.artifact),
            await coverageRecordChecks(check, run.artifact, run.result, {
                processModel: run.processModel,
                scheduling: run.scheduling
            })
        ]);
    }
});

const assertCompactOutcomeWithoutCoverage = defineCompositeAssertion({
    name: 'compact outcome without coverage',
    async assert(check, directory: string, result: RunResult) {
        const entries = await readdir(path.join(directory, 'runs'));
        const records = entries.filter(function recordFile(name) {
            return name.endsWith('.json');
        });
        const initialChecks = check.equal(records.length, 1);
        const record = JSON.parse(
            await readFile(path.join(directory, 'runs', records[0] ?? 'missing'), 'utf8')
        ) as CompactRunRecord;
        return check.group([
            initialChecks,
            check.partialDeepEqual({ record, status: result.status, artifacts: result.artifacts }, {
                record: { detail: 'compact', status: 'completed', replayPlan: null, result: { status: 'passed' } },
                status: 'passed',
                artifacts: []
            })
        ]);
    }
});

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

const assertCompletedCrashRecord = defineCompositeAssertion({
    name: 'completed crash record',
    async assert(check, rawDirectory: string) {
        const recordPath = `${path.resolve(rawDirectory, '../..')}.json`;
        const record = JSON.parse(await readFile(recordPath, 'utf8')) as SingleRunRecord;
        const initialChecksBeforeNextAction = check.equal(record.status, 'completed');
        if (record.result === null) {
            return check.group([ initialChecksBeforeNextAction, check.defined(record.result) ]);
        }
        return check.group([
            initialChecksBeforeNextAction,
            check.defined(record.result),
            check.partialDeepEqual(record.result, {
                status: 'failed',
                summary: { crashed: 1 },
                artifacts: [ {
                    id: {
                        subtype: 'worker-crash',
                        attempt: { index: 0 },
                        scope: { kind: 'case', case: { file: endlessLoopFixturePath, title: 'loops' } }
                    },
                    source: 'boundary-captured',
                    payload: {
                        kind: 'worker-crash',
                        reason: 'Supervised child exceeded hard timeout.',
                        capture: 'automatic',
                        completeness: 'best-effort'
                    }
                } ]
            }),
            check.equal(record.result.artifacts.length, 1),
            check.equal(path.resolve(record.coverage?.rawDataDirectory ?? 'missing'), path.resolve(rawDirectory))
        ]);
    }
});

export const testNode = suite('Runner coverage', [
    test('resolution writes no record and ordinary runs retain compact outcomes', async function (scope) {
        const config = {
            ...coverageConfig('in-process', 10_000, defaultCoveragePolicy, 'serial'),
            runtimeStateDir: await mkdtemp('target/coverage-disabled-integration-')
        };
        const command = {
            config,
            cwd: process.cwd(),
            engine: { kind: 'default' as const },
            request: coverageRequest()
        };
        const resolved = await orchestrator.resolve(command);
        scope.assert.deepEqual<unknown, unknown>(resolved.facts.coveragePolicy, defaultCoveragePolicy);
        await scope.assert.rejects(async function readResolveState() {
            await stat(path.join(config.runtimeStateDir, 'runs'));
        }, { code: 'ENOENT' });
        const result = await coverageSubject.run({ ...command, request: { ...command.request, coverage: false } });
        await scope.assert(assertCompactOutcomeWithoutCoverage, config.runtimeStateDir, result);

        return scope.assert.collect();
    }),
    table({
        title: 'serial coverage preserves scheduling in its record',
        cases: [ 'in-process', 'supervised-process' ],
        caseTitle(processModel) {
            return processModel;
        },
        async test(scope) {
            const processModel = scope.parameters;

            const coveredRun = await runCoverage(
                scope.cleanup,
                processModel === 'in-process' ? 'in-process' : 'supervised-process',
                'serial'
            );
            await scope.assert(successfulCoverageRun, coveredRun);
            return scope.assert.collect();
        }
    }),
    test('coverage threshold misses fail the run and retain the artifact', async function (scope: TestScope) {
        const result = await coverageSubject.run({
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

        return scope.assert.collect();
    }),
    test('in-process microtests emit native coverage artifacts', async function (scope) {
        const coveredRun = await runCoverage(scope.cleanup, 'in-process', 'concurrent');
        await scope.assert(successfulCoverageRun, coveredRun);

        return scope.assert.collect();
    }),
    test('crashed supervised runs retain raw storage without publishing a coverage artifact', async function (scope) {
        const result = await coverageSubject.run({
            config: {
                ...coverageConfig('supervised-process', 100, defaultCoveragePolicy, 'concurrent'),
                runtimeStateDir: isolatedRunStateDirectory()
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
        await scope.assert(assertCompletedCrashRecord, rawDirectory);

        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.crashed, 1);
        scope.assert.equal(coverageArtifacts.length, 0);
        scope.assert.equal(rawDirectoryStat.isDirectory(), true);

        return scope.assert.collect();
    }),
    test('supervised microtests emit native coverage artifacts', async function (scope) {
        const coveredRun = await runCoverage(scope.cleanup, 'supervised-process', 'concurrent');
        await scope.assert(successfulCoverageRun, coveredRun);

        return scope.assert.collect();
    }),
    test(
        'all-files reporting includes unloaded runtime source and omits type-only modules',
        async function (scope) {
            const coveredRun = await runCoverage(scope.cleanup, 'in-process', 'concurrent');
            await scope.assert(successfulCoverageRun, coveredRun);
            const { artifact } = coveredRun;
            const coverageDirectory = path.join(path.resolve(artifact.payload.directory), 'all-files');

            await generateCoverageReports({
                coverageDirectory,
                outputs: [ 'lcov' ],
                projectRoot: process.cwd(),
                rawDataDirectory: path.resolve(artifact.payload.rawDataDirectory),
                sourceScope: {
                    exclude: [ '**/*.test.ts' ],
                    excludedFiles: new Set([ path.resolve(coverageFixturePath) ]),
                    include: [ 'source/integration-tests/runtime/fixtures/coverage-*.ts' ],
                    mode: 'all'
                }
            });

            const lcov = await readFile(path.join(coverageDirectory, 'lcov.info'), 'utf8');

            scope.assert.true(lcov.includes('coverage-unloaded.ts'));
            scope.assert.false(lcov.includes('coverage-types.ts'));
            await loadCoverageFixtures();

            return scope.assert.collect();
        }
    )
]);
