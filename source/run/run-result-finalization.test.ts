import { suite, test } from '@overkill-dev/test';

import { withMemoryCoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunConfig } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createCoverageRunRecord } from './coverage-run-record.ts';
import { finalizeRunResult } from './run-result-finalization.ts';

export const testNode = suite('source/run/run-result-finalization.test.ts', [
    test('coverage and duration history precede the result checkpoint', async function (scope) {
        return await withMemoryCoverageRecordFixture(
            defaultRunConfig(),
            [],
            async function assertCoverageCheckpoint(fixture) {
                const command = {
                    ...fixture.request.command,
                    request: {
                        ...fixture
                            .request
                            .command
                            .request,
                        paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ]
                    }
                };
                const run = await createUnitRunOrchestrator().resolve(command);
                const attempt = await createCoverageRunRecord(
                    process.cwd(),
                    fixture.request.input,
                    fixture.request.dependencies,
                    null
                );
                await attempt.start();
                const result = await finalizeRunResult(run, runResultFactory.build({ status: 'passed' }), {
                    ...fixture.request,
                    baseline: null,
                    record: attempt.record,
                    coverageSession: {
                        childProcess: null,
                        async dispose() {
                            return undefined;
                        },
                        async finalize(coverageResult) {
                            return {
                                ...coverageResult,
                                status: 'failed',
                                runnerErrors: [ {
                                    attributedToAttempt: null,
                                    attributedTo: null,
                                    cause: null,
                                    diagnostics: [],
                                    message: 'Coverage failed',
                                    subtype: 'coverage'
                                } ]
                            };
                        }
                    }
                });
                scope.assert.equal(result.status, 'failed');
                scope.assert.equal(fixture.records.at(-1)?.status, 'started');
                scope.assert.equal(fixture.records.at(-1)?.result?.runnerErrors.length, 1);
                return scope.assert.collect();
            }
        );
    })
]);
