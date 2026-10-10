import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { withCoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunConfig } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createCoverageRunRecord } from './coverage-run-record.ts';
import { finalizeSupervisedResult } from './run-supervised-finalization.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-supervised-finalization.test.ts',
    annotations: {},
    controls: {},
    children: [ createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        title: 'coverage and duration history precede the result checkpoint',
        annotations: {},
        controls: {},
        async body(scope) {
            return await withCoverageRecordFixture(
                defaultRunConfig(),
                [],
                async function assertSupervisedCheckpoint(fixture) {
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
                    const run = await createDeterministicRunOrchestrator().resolve(command);
                    const attempt = await createCoverageRunRecord(
                        process.cwd(),
                        fixture.request.input,
                        fixture.request.dependencies,
                        null
                    );
                    await attempt.start();
                    const result = await finalizeSupervisedResult(run, runResultFactory.build({ status: 'passed' }), {
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
        }
    }) ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
