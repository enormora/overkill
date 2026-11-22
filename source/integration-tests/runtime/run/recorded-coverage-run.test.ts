import path from 'node:path';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { table, suite, test } from '@overkill-dev/test';

import type { RunResult, RunArtifactId } from '../../../packages/engine/engine.entry-point.ts';
import {
    withCoverageRecordFixture,
    writeNativeCoverage,
    type CoverageRecordFixture
} from '../../../test-support/coverage-record-fixture.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../../../test-support/run-command-factory.ts';
import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import { defineFixedReporter } from '../../../test-support/reporter-definition.ts';
import { RunCollectionError } from '../../../run/run-errors.ts';
import { runRecordedCoverage } from '../../../run/recorded-coverage-run.ts';

const config = defaultRunConfig({ profiles: { microtest: defaultMicrotestProfile({ coverage: { outputs: [] } }) } });

const finalArtifactsChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    fixture: CoverageRecordFixture,
    result: RunResult
): CompositeAssertionReturn<'assert'> {
    const record = fixture.records.at(-1);
    if (record === undefined) {
        return check.defined(record);
    }
    if (record.result === null) {
        return check.defined(record.result);
    }
    return check.group([
        check.equal(record.status, 'completed'),
        check.deepEqual<unknown, unknown>(record.result.artifacts, result.artifacts),
        check.equal(record.result.runnerErrors.length, result.runnerErrors.length)
    ]);
};

function capturedArtifacts(): RunResult['artifacts'] {
    const testCase = { file: 'fixture.ts', params: null, suite: [], title: 'passes' };
    const identities: readonly RunArtifactId[] = [
        {
            familyVariant: null,
            attempt: null,
            runtimes: [],
            scope: { kind: 'run' },
            sequence: 3,
            subtype: 'log-capture',
            workload: null
        },
        {
            familyVariant: null,
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
                capture: 'automatic' as const,
                completeness: 'best-effort' as const,
                stream: 'stdout' as const,
                text: 'log',
                truncated: false
            },
            source: 'native' as const
        };
    });
}

const assertCoverageArtifacts = defineCompositeAssertion({
    name: 'coverage artifacts',
    async assert(check, fixture: CoverageRecordFixture, threshold: number) {
        const result = await runRecordedCoverage({
            ...fixture.request,
            async execute({ record, session }) {
                const directory = session.childProcess?.environment.NODE_V8_COVERAGE;
                if (directory === undefined) {
                    throw new Error('Supervised coverage must expose a raw directory.');
                }
                await record.recordFacts(fixture.facts, null);
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
        return check.group([
            check.equal(result.status, threshold === 0 ? 'passed' : 'failed'),
            check.equal(result.artifacts.length, 3),
            check.equal(result.artifacts[2]?.payload.kind, 'coverage'),
            check.equal(result.artifacts[2]?.id.sequence, 4),
            finalArtifactsChecks(check.annotated('final artifacts'), fixture, result)
        ]);
    }
});

export const testNode = suite('Recorded coverage run', [
    table({
        title: 'coverage artifacts persist after finalization with threshold',
        cases: [ 0, 100 ],
        caseTitle: String,
        async test(scope) {
            const threshold = scope.parameters;

            return await withCoverageRecordFixture(
                defaultRunConfig({
                    profiles: {
                        microtest: defaultMicrotestProfile({
                            coverage: {
                                sources: {
                                    mode: 'all',
                                    include: [ 'source/integration-tests/runtime/fixtures/coverage-source.ts' ],
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
                    await scope.assert(assertCoverageArtifacts, fixture, threshold);
                    return scope.assert.collect();
                }
            );
        }
    }),
    test(
        'writes the attempt before setup and completes only after the returned result',
        async function (scope) {
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
                        await record.recordFacts(fixture.facts, null);
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
    ),
    test('required start persistence gates setup and execution', async function (scope) {
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
    }),
    test(
        'coverage setup failures retain the selected policy and planned output paths',
        async function (scope) {
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
    ),
    test('known import errors complete with reporter failures in the final record', async function (scope) {
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
    }),
    test(
        'escaping exceptions interrupt the attempt and preserve the original error',
        async function (scope) {
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
    ),
    test('interrupted persistence failure preserves both errors', async function (scope) {
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
    })
]);
