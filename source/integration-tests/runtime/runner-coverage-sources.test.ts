import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, createTestFacade } from '@overkill-dev/test';
import { testWorkspace } from '../../test-support/test-workspace.ts';

import type { RunResult, CoverageRunnerError } from '../../packages/engine/engine.entry-point.ts';

import type { CoveragePolicy, SingleRunRecord } from '../../packages/run/run.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { coverageSubject } from './support/coverage-subject.ts';

const fixtureRoot = 'source/integration-tests/runtime/fixtures/';
const scenarios = [ 'unloaded', 'threshold', 'types-only', 'missing-sources', 'broken-map' ] as const;
type CoverageScenario = typeof scenarios[number];
type RecordedCoverageResult = { readonly record: SingleRunRecord; readonly result: RunResult; };

function scenarioCoverage(scenario: CoverageScenario, directory: string): Partial<CoveragePolicy> {
    if (scenario === 'broken-map') {
        return { sources: { mode: 'all', include: [ path.resolve(directory, 'broken-source.mjs') ], exclude: [] } };
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

async function readCompletedRecord(directory: string): Promise<SingleRunRecord> {
    const files = await readdir(path.join(directory, 'runs'));
    const file = files.find(function isRecord(candidate) {
        return candidate.endsWith('.json');
    });

    if (file === undefined) {
        throw new Error('Coverage run did not persist a record.');
    }
    return JSON.parse(await readFile(path.join(directory, 'runs', file), 'utf8')) as SingleRunRecord;
}

async function brokenMapFixture(directory: string): Promise<string> {
    const file = path.resolve(directory, 'broken-map.test.ts');
    const engine = new URL('../../packages/engine/engine.entry-point.ts', import.meta.url);
    await writeFile(
        path.join(directory, 'broken-source.mjs'),
        [
            'export function coveredValue() { return 42; }',
            '//# sourceMappingURL=coverage-missing.map'
        ]
            .join('\n')
    );
    await writeFile(
        file,
        [
            `import { createTestCase } from ${JSON.stringify(engine.href)};`,
            "import { coveredValue } from './broken-source.mjs';",
            "export const testNode = createTestCase({ annotations: {}, controls: {}, definitionLocations: [{ kind: 'unknown' }],",
            "title: 'covers a source with a broken map', body(scope) {",
            'scope.assert.equal(coveredValue(), 42); return scope.assert.collect(); } });'
        ]
            .join('\n')
    );
    return file;
}

async function executeCoverageScenario(
    directory: string,
    processModel: 'in-process' | 'supervised-process',
    scenario: CoverageScenario
): Promise<RecordedCoverageResult> {
    const file = scenario === 'broken-map' ? await brokenMapFixture(directory) : `${fixtureRoot}coverage.test.ts`;
    const result = await coverageSubject.run({
        config: defaultRunConfig({
            profiles: {
                microtest: defaultMicrotestProfile({
                    coverage: {
                        ...scenarioCoverage(scenario, directory),
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
            paths: [ file ]
        })
    });

    return { record: await readCompletedRecord(directory), result };
}

const assertCoverageRecord = defineCompositeAssertion({
    name: 'coverage record',
    async assert(check, scenario: CoverageScenario, recorded: RecordedCoverageResult) {
        const { record, result } = recorded;
        if (record.coverage === null) {
            return check.defined(record.coverage);
        }
        const rawFiles = await readdir(path.resolve(record.coverage.rawDataDirectory));
        return check.group([
            check.equal(record.status, 'completed'),
            check.equal(result.status, scenario === 'unloaded' ? 'passed' : 'failed'),
            check.equal(record.result?.status, result.status),
            check.deepEqual<unknown, unknown>(record.result?.artifacts, result.artifacts),
            check.true(rawFiles.length > 0)
        ]);
    }
});

const assertCoverageArtifact = defineCompositeAssertion({
    name: 'coverage artifact',
    assert(check, result: RunResult) {
        const artifact = result.artifacts.find(function isCoverage(candidate) {
            return candidate.payload.kind === 'coverage';
        });
        if (artifact === undefined) {
            return check.defined(artifact);
        }
        if (artifact.payload.kind !== 'coverage') {
            throw new Error('Expected a coverage artifact.');
        }
        return check.group([
            check.equal(artifact.payload.summary.functions.covered, 0),
            check.true(artifact.payload.summary.functions.total > 0)
        ]);
    }
});

const assertCoverageReportingError = defineCompositeAssertion({
    name: 'coverage reporting error',
    assert(check, scenario: CoverageScenario, result: RunResult) {
        const error = result.runnerErrors.find(function coverageError(candidate): candidate is CoverageRunnerError {
            return candidate.subtype === 'coverage';
        });
        const initialChecks = check.deepEqual(result.artifacts, []);
        if (error === undefined) {
            return check.group([ initialChecks, check.defined(error) ]);
        }
        return check.group([
            initialChecks,
            check.defined(error),
            check.includes(
                error.message,
                scenario === 'broken-map' ? 'Coverage source map failed' : 'no executable sources'
            ),
            check.equal(error.cause.kind, 'coverage-operation')
        ]);
    }
});

const { table } = createTestFacade({ resources: { workspace: testWorkspace } });

export const testNode = suite(
    'Runner coverage sources',
    [ table({
        title: 'coverage records source selection',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processModelCases(model) {
            return scenarios.map(function sourceScenario(scenario) {
                return { model, scenario };
            });
        }),
        caseTitle({ model, scenario }) {
            return [ model, scenario ].map(String).join(', ');
        },
        async test({ resources, assert, parameters: { model, scenario } }) {
            const recorded = await executeCoverageScenario(resources.workspace, model, scenario);

            await assert(assertCoverageRecord, scenario, recorded);
            const coverageOutcomeResult = recorded.result;
            if (scenario === 'unloaded' || scenario === 'threshold') {
                assert(assertCoverageArtifact, coverageOutcomeResult);
            } else {
                assert(assertCoverageReportingError, scenario, coverageOutcomeResult);
            }
            if (scenario === 'threshold') {
                const coverageOutcomeErrors = coverageOutcomeResult.runnerErrors.filter(
                    function coverageError(candidate): candidate is CoverageRunnerError {
                        return candidate.subtype === 'coverage';
                    }
                );

                assert.true(coverageOutcomeErrors.some(function thresholdFailure(error) {
                    return error.cause.kind === 'coverage-threshold';
                }));
            }

            return assert.collect();
        }
    }) ]
);
