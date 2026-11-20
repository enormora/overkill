import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestNode, suite } from '@overkill-dev/test';

import type { RunResult } from '../../packages/engine/engine.entry-point.ts';

import type { SingleRunRecord, RunRequest, MicrotestExecution } from '../../packages/run/run.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { coverageSubject } from './support/coverage-subject.ts';

const coverageFile = 'source/integration-tests/integration/fixtures/coverage.test.ts';
type MicrotestProcessModel = MicrotestExecution['processModel'];
const processModels: readonly MicrotestProcessModel[] = [ 'in-process', 'supervised-process' ];
type RecordedResult = { readonly directory: string; readonly record: SingleRunRecord; readonly result: RunResult; };

async function singleRunRecord(directory: string): Promise<SingleRunRecord> {
    const files = await readdir(path.join(directory, 'runs'));
    const records = files.filter(function isRecord(file) {
        return file.endsWith('.json');
    });
    const [ file ] = records;
    if (file === undefined || records.length !== 1) {
        throw new Error('Expected exactly one run record.');
    }
    return JSON.parse(await readFile(path.join(directory, 'runs', file), 'utf8')) as SingleRunRecord;
}

async function withRecordedResult<Value>(
    processModel: MicrotestProcessModel,
    request: Partial<RunRequest>,
    work: (result: RecordedResult) => Promise<Value>
): Promise<Value> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/coverage-record-integration-');
    const config = defaultRunConfig({
        profiles: {
            microtest: defaultMicrotestProfile({
                coverage: { outputDirectory: path.resolve(directory, 'reports'), outputs: [] },
                execution: { processModel, scheduling: 'serial' },
                timeouts: { collectionMilliseconds: 10_000, hardMilliseconds: 10_000, softMilliseconds: 5000 }
            })
        },
        runtimeStateDir: directory
    });
    try {
        const result = await coverageSubject.run({
            config,
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({ coverage: true, paths: [ coverageFile ], ...request })
        });
        return await work({ directory, record: await singleRunRecord(directory), result });
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

export const testNode: TestNode = suite(
    'Runner coverage records',
    [
        table({
            title: 'raw-only coverage records custom paths and artifact references',
            cases: processModels.flatMap(function coverageRecordTests(processModel) {
                return { processModel };
            }),
            caseTitle({ processModel }) {
                return [ processModel ].map(String).join(', ');
            },
            async test(scope) {
                const { processModel } = scope.parameters;

                const require: typeof scope.require = scope.require;

                return await withRecordedResult(
                    processModel,
                    {},
                    async function assertCustomRecord({ record, result }) {
                        require.defined(record.coverage);
                        require.defined(record.facts);
                        scope.assert.equal(result.status, 'passed');
                        scope.assert.equal(record.status, 'completed');
                        scope.assert.equal(record.coverage.policy.outputDirectory, record.coverage.directory);
                        scope.assert.equal(
                            record.coverage.rawDataDirectory,
                            `${record.coverage.directory}/raw/${record.id}`
                        );
                        scope.assert.deepEqual(record.coverage.policy.outputs, []);
                        scope.assert.deepEqual<unknown, unknown>(record.result?.artifacts, result.artifacts);
                        scope.assert.equal(record.facts.cases.length, 1);
                        return scope.assert.collect();
                    }
                );
            }
        }),
        table({
            title: 'filtered empty selections retain complete empty facts',
            cases: processModels.flatMap(function coverageRecordTests(processModel) {
                return { processModel };
            }),
            caseTitle({ processModel }) {
                return [ processModel ].map(String).join(', ');
            },
            async test(scope) {
                const { processModel } = scope.parameters;

                const require: typeof scope.require = scope.require;

                return await withRecordedResult(processModel, {
                    selection: { kind: 'filter', filter: { field: 'title', kind: 'equals', value: 'missing test' } }
                }, async function assertEmptyRecord({ record, result }) {
                    require.defined(record.facts);
                    scope.assert.equal(record.status, 'completed');
                    scope.assert.equal(
                        result.planStatus,
                        processModel === 'in-process' ? 'empty-selection' : 'planned'
                    );
                    scope.assert.equal(result.summary.planned, 0);
                    scope.assert.deepEqual(record.facts.cases, []);
                    scope.assert.deepEqual(record.identities, []);
                    scope.assert.equal(record.facts.execution.processModel, processModel);
                    return scope.assert.collect();
                });
            }
        }),
        table({
            title: 'covered merge inputs retain complete facts and returned outcomes',
            cases: processModels.flatMap(function coverageRecordTests(processModel) {
                return { processModel };
            }),
            caseTitle({ processModel }) {
                return [ processModel ].map(String).join(', ');
            },
            async test(scope) {
                const { processModel } = scope.parameters;

                const require: typeof scope.require = scope.require;

                const counts: number[] = [];
                for (const index of [ 1, 2 ]) {
                    await withRecordedResult(
                        processModel,
                        { recordForMerge: true, shard: { index, total: 2 } },
                        async function assertShardRecord({ directory, record, result }) {
                            require.defined(record.facts);
                            require.defined(record.coverage);
                            scope.assert.equal(record.status, 'completed');
                            scope.assert.equal(record.request.recordForMerge, true);
                            scope.assert.deepEqual(record.facts.execution.runRecords.reasons, [
                                'merge',
                                'coverage'
                            ]);
                            scope.assert.equal(record.result?.planStatus, result.planStatus);
                            scope.assert.equal(record.facts.cases.length, result.summary.planned);
                            const stateEntries = await readdir(directory);
                            scope.assert.deepEqual(
                                stateEntries.filter(function historyEntry(entry) {
                                    return entry === 'history' || entry === 'duration-history';
                                }),
                                []
                            );
                            counts.push(result.summary.planned);
                        }
                    );
                }
                scope.assert.deepEqual(
                    counts.toSorted(function compareCounts(first, second) {
                        return first - second;
                    }),
                    [ 0, 1 ]
                );
                return scope.assert.collect();
            }
        }),
        table({
            title: 'import failures retain an attempt without invented facts',
            cases: processModels.flatMap(function coverageRecordTests(processModel) {
                return { processModel };
            }),
            caseTitle({ processModel }) {
                return [ processModel ].map(String).join(', ');
            },
            async test(scope) {
                const { processModel } = scope.parameters;

                return await withRecordedResult(processModel, {
                    paths: [ 'source/integration-tests/integration/fixtures/throws-on-import.test.ts' ]
                }, async function assertImportRecord({ record, result }) {
                    scope.assert.equal(result.status, 'failed');
                    scope.assert.equal(record.status, 'completed');
                    scope.assert.equal(record.facts, null);
                    scope.assert.deepEqual(record.identities, []);
                    scope.assert.equal(record.result?.status, result.status);
                    scope.assert.deepEqual<unknown, unknown>(record.result?.artifacts, []);
                    return scope.assert.collect();
                });
            }
        })
    ]
);
