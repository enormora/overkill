import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
    createSuite,
    createTestCase,
    type RunResult,
    type CoverageRunnerError,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { orchestrator, type RunCoveragePolicy, type RunRecord } from '../../packages/run/run.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const fixtureRoot = 'source/integration-tests/run/fixtures/';
const scenarios = [ 'unloaded', 'threshold', 'types-only', 'missing-sources', 'broken-map' ] as const;
type CoverageScenario = typeof scenarios[number];
type RecordedCoverageResult = { readonly record: RunRecord; readonly result: RunResult; };

function scenarioCoverage(scenario: CoverageScenario): Partial<RunCoveragePolicy> {
    if (scenario === 'broken-map') {
        return {};
    }
    const files = {
        'missing-sources': 'coverage-missing-source.ts',
        threshold: 'coverage-unloaded.ts',
        'types-only': 'coverage-types.ts',
        unloaded: 'coverage-unloaded.ts'
    };

    return {
        sources: { exclude: [], include: [ `${fixtureRoot}${files[scenario]}` ], mode: 'all' },
        thresholds: { branches: null, functions: scenario === 'threshold' ? 100 : null, lines: null }
    };
}

async function readCompletedRecord(directory: string): Promise<RunRecord> {
    const files = await readdir(path.join(directory, 'runs'));
    const file = files.find(function isRecord(candidate) {
        return candidate.endsWith('.json');
    });

    if (file === undefined) {
        throw new Error('Coverage run did not persist a record.');
    }
    return JSON.parse(await readFile(path.join(directory, 'runs', file), 'utf8')) as RunRecord;
}

async function executeCoverageScenario(
    directory: string,
    processModel: 'in-process' | 'supervised-process',
    scenario: CoverageScenario
): Promise<RecordedCoverageResult> {
    const result = await orchestrator.run({
        config: defaultRunConfig({
            profiles: {
                microtest: defaultMicrotestProfile({
                    coverage: {
                        ...scenarioCoverage(scenario),
                        outputDirectory: path.resolve(directory, 'report'),
                        outputs: [ 'lcov' ]
                    },
                    execution: { processModel, scheduling: 'serial' },
                    timeouts: { collectionMilliseconds: 10_000, hardMilliseconds: 10_000, softMilliseconds: 5000 }
                })
            },
            runtimeStateDir: directory
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            coverage: true,
            paths: [ `${fixtureRoot}${scenario === 'broken-map' ? 'coverage-broken-map.test.ts' : 'coverage.test.ts'}` ]
        })
    });

    return { record: await readCompletedRecord(directory), result };
}

async function assertCoverageRecord(
    scope: TestScope,
    scenario: CoverageScenario,
    recorded: RecordedCoverageResult
): Promise<void> {
    const { record, result } = recorded;

    scope.require.defined(record.coverage);
    const rawFiles = await readdir(path.resolve(record.coverage.rawDataDirectory));

    scope.assert.equal(record.status, 'completed');
    scope.assert.equal(result.status, scenario === 'unloaded' ? 'passed' : 'failed');
    scope.assert.equal(record.result?.status, result.status);
    scope.assert.deepEqual<unknown, unknown>(record.result?.artifacts, result.artifacts);
    scope.assert.true(rawFiles.length > 0);
}

function assertCoverageArtifact(scope: TestScope, result: RunResult): void {
    const artifact = result.artifacts.find(function isCoverage(candidate) {
        return candidate.payload.kind === 'coverage';
    });

    scope.require.defined(artifact);
    if (artifact.payload.kind !== 'coverage') {
        throw new Error('Expected a coverage artifact.');
    }
    scope.assert.equal(artifact.payload.summary.functions.covered, 0);
    scope.assert.true(artifact.payload.summary.functions.total > 0);
}

function assertCoverageReportingError(scope: TestScope, scenario: CoverageScenario, result: RunResult): void {
    const error = result.runnerErrors.find(function coverageError(candidate): candidate is CoverageRunnerError {
        return candidate.subtype === 'coverage';
    });

    scope.assert.deepEqual(result.artifacts, []);
    scope.require.defined(error);
    scope.assert.includes(
        error.message,
        scenario === 'broken-map' ? 'Coverage source map failed' : 'no executable sources'
    );
    scope.assert.equal(error.cause.kind, 'coverage-operation');
}

function assertCoverageOutcome(scope: TestScope, scenario: CoverageScenario, result: RunResult): void {
    if (scenario === 'unloaded' || scenario === 'threshold') {
        assertCoverageArtifact(scope, result);
    } else {
        assertCoverageReportingError(scope, scenario, result);
    }
    if (scenario === 'threshold') {
        const errors = result.runnerErrors.filter(function coverageError(candidate): candidate is CoverageRunnerError {
            return candidate.subtype === 'coverage';
        });

        scope.assert.true(errors.some(function thresholdFailure(error) {
            return error.cause.kind === 'coverage-threshold';
        }));
    }
}

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-coverage-sources.test.ts',
    children: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processModelCases(model) {
        return scenarios.map(function sourceScenario(scenario) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${model} coverage records ${scenario} source selection`,
                async body(scope: TestScope) {
                    await mkdir('target', { recursive: true });
                    const directory = await mkdtemp('target/coverage-sources-integration-');

                    try {
                        const recorded = await executeCoverageScenario(directory, model, scenario);

                        await assertCoverageRecord(scope, scenario, recorded);
                        assertCoverageOutcome(scope, scenario, recorded.result);
                    } finally {
                        await rm(directory, { force: true, recursive: true });
                    }
                    return scope.assert.collect();
                }
            });
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
