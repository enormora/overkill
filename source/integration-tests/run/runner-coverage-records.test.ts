import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
    createSuite,
    createTestCase,
    type RunResult,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import {
    orchestrator,
    type RunRecord,
    type RunRequest,
    type MicrotestExecution
} from '../../packages/run/run.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const coverageFile = 'source/integration-tests/run/fixtures/coverage.test.ts';
type MicrotestProcessModel = MicrotestExecution['processModel'];
const processModels: readonly MicrotestProcessModel[] = [ 'in-process', 'supervised-process' ];
type RecordedResult = { readonly record: RunRecord; readonly result: RunResult; };

async function singleRunRecord(directory: string): Promise<RunRecord> {
    const files = await readdir(path.join(directory, 'runs'));
    const records = files.filter(function isRecord(file) {
        return file.endsWith('.json');
    });
    const [ file ] = records;
    if (file === undefined || records.length !== 1) {
        throw new Error('Expected exactly one run record.');
    }
    return JSON.parse(await readFile(path.join(directory, 'runs', file), 'utf8')) as RunRecord;
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
        const result = await orchestrator.run({
            config,
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({ coverage: true, paths: [ coverageFile ], ...request })
        });
        return await work({ record: await singleRunRecord(directory), result });
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-coverage-records.test.ts',
    annotations: {},
    controls: {},
    children: processModels.flatMap(function coverageRecordTests(processModel) {
        return [
            createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${processModel} raw-only coverage records custom paths and artifact references`,
                annotations: {},
                controls: {},
                async body(scope: TestScope) {
                    return await withRecordedResult(
                        processModel,
                        {},
                        async function assertCustomRecord({ record, result }) {
                            scope.require.defined(record.coverage);
                            scope.require.defined(record.facts);
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
            createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${processModel} filtered empty selections retain complete empty facts`,
                annotations: {},
                controls: {},
                async body(scope: TestScope) {
                    return await withRecordedResult(processModel, {
                        selection: { kind: 'filter', filter: { field: 'title', kind: 'equals', value: 'missing test' } }
                    }, async function assertEmptyRecord({ record, result }) {
                        scope.require.defined(record.facts);
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
            createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${processModel} empty shards retain complete facts and returned outcomes`,
                annotations: {},
                controls: {},
                async body(scope: TestScope) {
                    const counts: number[] = [];
                    for (const index of [ 1, 2 ]) {
                        await withRecordedResult(
                            processModel,
                            { shard: { index, total: 2 } },
                            async function assertShardRecord({ record, result }) {
                                scope.require.defined(record.facts);
                                scope.assert.equal(record.status, 'completed');
                                scope.assert.equal(record.result?.planStatus, result.planStatus);
                                scope.assert.equal(record.facts.cases.length, result.summary.planned);
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
            createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${processModel} import failures retain an attempt without invented facts`,
                annotations: {},
                controls: {},
                async body(scope: TestScope) {
                    return await withRecordedResult(processModel, {
                        paths: [ 'source/integration-tests/run/fixtures/throws-on-import.test.ts' ]
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
        ];
    })
});
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
