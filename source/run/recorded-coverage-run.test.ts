import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    createSuite,
    createTestCase,
    type TestScope,
    type RunResult,
    type RunArtifactId
} from '../packages/engine/engine.entry-point.ts';
import { withCoverageRecordFixture, type CoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import { RunCollectionError } from './run-errors.ts';
import { runRecordedCoverage } from './recorded-coverage-run.ts';

const config = defaultRunConfig({ profiles: { microtest: defaultMicrotestProfile({ coverage: { outputs: [] } }) } });

async function writeNativeCoverage(directory: string): Promise<void> {
    const url = new URL('../integration-tests/run/fixtures/coverage-source.ts', import.meta.url);
    const source = await readFile(url, 'utf8');
    await writeFile(
        path.join(directory, 'coverage-test.json'),
        JSON.stringify({
            result: [ {
                functions: [ {
                    functionName: '',
                    isBlockCoverage: true,
                    ranges: [ { count: 0, endOffset: source.length, startOffset: 0 } ]
                } ],
                scriptId: '1',
                url: url.href
            } ],
            timestamp: 0
        })
    );
}

function assertFinalArtifacts(scope: TestScope, fixture: CoverageRecordFixture, result: RunResult): void {
    const record = fixture.records.at(-1);
    scope.require.defined(record);
    scope.require.defined(record.result);
    scope.assert.equal(record.status, 'completed');
    scope.assert.deepEqual<unknown, unknown>(record.result.artifacts, result.artifacts);
    scope.assert.equal(record.result.runnerErrors.length, result.runnerErrors.length);
}

function capturedArtifacts(): RunResult['artifacts'] {
    const testCase = { file: 'fixture.ts', params: null, suite: [], title: 'passes' };
    const identities: readonly RunArtifactId[] = [
        { attempt: null, runtimes: [], scope: { kind: 'run' }, sequence: 3, subtype: 'log-capture', workload: null },
        {
            attempt: { index: 0 },
            runtimes: [],
            sequence: 3,
            subtype: 'log-capture',
            workload: null,
            scope: {
                activeCases: [ { ...testCase, suite: [] } ],
                case: testCase,
                confidence: 'active-case' as const,
                kind: 'case' as const
            }
        }
    ];
    return identities.map(function capturedArtifact(id) {
        return {
            id: { ...id, subtype: 'log-capture' as const },
            payload: {
                byteLength: 3,
                capturedAtMicroseconds: 0,
                kind: 'captured-output' as const,
                stream: 'stdout' as const,
                text: 'log',
                truncated: false
            },
            source: 'native' as const
        };
    });
}

async function assertCoverageArtifacts(
    scope: TestScope,
    fixture: CoverageRecordFixture,
    threshold: number
): Promise<void> {
    const result = await runRecordedCoverage({
        ...fixture.request,
        async execute({ record, session }) {
            const directory = session.childProcess?.environment.NODE_V8_COVERAGE;
            if (directory === undefined) {
                throw new Error('Supervised coverage must expose a raw directory.');
            }
            await record.recordFacts(fixture.facts);
            await writeNativeCoverage(directory);
            return await record.checkpointResult(
                await session.finalize(runResultFactory
                    .build({
                        artifacts: capturedArtifacts(),
                        summary: { discovered: 1, defined: 1, planned: 1, passed: 1 }
                    }))
            );
        }
    });
    scope.assert.equal(result.status, threshold === 0 ? 'passed' : 'failed');
    scope.assert.equal(result.artifacts.length, 3);
    scope.assert.equal(result.artifacts[2]?.payload.kind, 'coverage');
    scope.assert.equal(result.artifacts[2]?.id.sequence, 4);
    assertFinalArtifacts(scope, fixture, result);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/recorded-coverage-run.test.ts',
    annotations: {},
    controls: {},
    children: [
        ...[ 0, 100 ].map(function coverageArtifactTest(threshold) {
            return createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `coverage artifacts persist after finalization with threshold ${threshold}`,
                annotations: {},
                controls: {},
                async body(scope: TestScope) {
                    return await withCoverageRecordFixture(
                        defaultRunConfig({
                            profiles: {
                                microtest: defaultMicrotestProfile({
                                    coverage: {
                                        sources: {
                                            mode: 'all',
                                            include: [ 'source/integration-tests/run/fixtures/coverage-source.ts' ],
                                            exclude: []
                                        },
                                        outputs: [],
                                        thresholds: { branches: threshold, functions: threshold, lines: threshold }
                                    }
                                })
                            }
                        }),
                        [],
                        async function verifyArtifact(fixture) {
                            await assertCoverageArtifacts(scope, fixture, threshold);
                            return scope.assert.collect();
                        }
                    );
                }
            });
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'writes the attempt before setup and completes only after the returned result',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(config, [], async function verifyRecord(fixture) {
                    const result = await runRecordedCoverage({
                        ...fixture.request,
                        async execute({ record, session }) {
                            scope.assert.equal(fixture.records[0]?.status, 'started');
                            scope.assert.equal(fixture.records[0]?.facts, null);
                            scope.assert.equal(
                                session.childProcess?.writablePath.endsWith(`${record.id}/coverage/raw/*`),
                                true
                            );
                            await record.recordFacts(fixture.facts);
                            return await record.checkpointResult(
                                runResultFactory.build({
                                    summary: { discovered: 1, defined: 1, planned: 1, passed: 1 }
                                })
                            );
                        }
                    });
                    scope.assert.equal(result.status, 'passed');
                    scope.assert.equal(fixture.records.at(-1)?.status, 'completed');
                    scope.assert.deepEqual<unknown, unknown>(fixture.records.at(-1)?.facts, fixture.facts);

                    return scope.assert.collect();
                });
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'required start persistence gates setup and execution',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(config, [ 1 ], async function verifyRecord(fixture) {
                    let executed = false;

                    const result = await runRecordedCoverage({
                        ...fixture.request,
                        async execute() {
                            executed = true;
                            return runResultFactory.build();
                        }
                    });
                    scope.assert.equal(executed, false);
                    scope.assert.equal(result.status, 'failed');
                    scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-state');
                    scope.assert.equal(fixture.records.at(-1)?.facts, null);

                    return scope.assert.collect();
                });
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage setup failures retain the selected policy and planned output paths',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(
                    defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                coverage: { outputDirectory: path.resolve(process.cwd(), '..', 'outside-project') }
                            })
                        }
                    }),
                    [],
                    async function verifyRecord(fixture) {
                        const result = await runRecordedCoverage({
                            ...fixture.request,
                            async execute() {
                                throw new Error('Execution must not start');
                            }
                        });
                        scope.assert.equal(result.runnerErrors[0]?.subtype, 'coverage');
                        scope.assert.equal(fixture.records.at(-1)?.status, 'completed');
                        scope.assert.equal(fixture.records.at(-1)?.facts, null);
                        scope.assert.equal(fixture.records.at(-1)?.coverage?.directory, '../outside-project');

                        return scope.assert.collect();
                    }
                );
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'known import errors complete with reporter failures in the final record',
            annotations: {},
            controls: {},
            async body(scope) {
                const reporter = defineFixedReporter({
                    kind: 'real-time',
                    name: 'failing-finish',
                    sinks: [ { kind: 'memory' } ],
                    dispose: null,
                    onEvent() {
                        return undefined;
                    },
                    onFinish() {
                        throw new Error('Reporter failed');
                    }
                });
                return await withCoverageRecordFixture(
                    { ...config, reporters: [ reporter ] },
                    [],
                    async function verifyRecord(fixture) {
                        const result = await runRecordedCoverage({
                            ...fixture.request,
                            async execute() {
                                throw new RunCollectionError('Import failed', { cause: 42n }, 'loader');
                            }
                        });
                        scope.assert.equal(result.runnerErrors.length, 2);
                        scope.assert.equal(fixture.records.at(-1)?.status, 'completed');
                        scope.assert.equal(fixture.records.at(-1)?.result?.runnerErrors.length, 2);
                        scope.assert.equal(fixture.records.at(-1)?.facts, null);

                        return scope.assert.collect();
                    }
                );
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'escaping exceptions interrupt the attempt and preserve the original error',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(config, [], async function verifyRecord(fixture) {
                    await scope.assert.rejects(async function runUnexpectedFailure() {
                        await runRecordedCoverage({
                            ...fixture.request,
                            async execute() {
                                throw new TypeError('Unexpected failure');
                            }
                        });
                    }, { name: 'TypeError', message: 'Unexpected failure' });
                    scope.assert.equal(fixture.records.at(-1)?.status, 'interrupted');
                    scope.assert.equal(fixture.records.at(-1)?.result?.status, 'failed');

                    return scope.assert.collect();
                });
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'interrupted persistence failure preserves both errors',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(config, [ 2 ], async function verifyRecord(fixture) {
                    await scope.assert.rejects(async function runFailedInterruption() {
                        await runRecordedCoverage({
                            ...fixture.request,
                            async execute() {
                                throw new Error('Original failure');
                            }
                        });
                    }, { name: 'AggregateError', message: 'Execution and run record persistence failed.' });
                    scope.assert.equal(fixture.records.length, 1);

                    return scope.assert.collect();
                });
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
