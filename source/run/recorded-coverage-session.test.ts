import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { withCoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { defaultRunConfig } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createCoverageRunRecord } from './coverage-run-record.ts';
import { executeRecordedCoverageSession } from './recorded-coverage-session.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/recorded-coverage-session.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'cleanup failures fail returned results',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(
                    defaultRunConfig(),
                    [],
                    async function assertCleanupFailure(fixture) {
                        const attempt = await createCoverageRunRecord(
                            process.cwd(),
                            fixture.request.input,
                            fixture.request.dependencies,
                            null
                        );
                        const result = await executeRecordedCoverageSession({
                            ...fixture.request,
                            async execute() {
                                return runResultFactory.build({ status: 'passed' });
                            }
                        }, {
                            record: attempt.record,
                            session: {
                                childProcess: null,
                                async dispose() {
                                    throw new Error('Cleanup failed');
                                },
                                async finalize(coverageResult) {
                                    return coverageResult;
                                }
                            }
                        });
                        scope.assert.equal(result.status, 'failed');
                        scope.assert.equal(result.runnerErrors[0]?.subtype, 'coverage');
                        scope.assert.equal(result.runnerErrors[0]?.message, 'Coverage cleanup failed.');
                        return scope.assert.collect();
                    }
                );
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'escaping execution and cleanup errors are preserved together',
            annotations: {},
            controls: {},
            async body(scope) {
                return await withCoverageRecordFixture(
                    defaultRunConfig(),
                    [],
                    async function assertCombinedFailure(fixture) {
                        const attempt = await createCoverageRunRecord(
                            process.cwd(),
                            fixture.request.input,
                            fixture.request.dependencies,
                            null
                        );
                        await scope.assert.rejects(async function failDuringExecutionAndCleanup() {
                            await executeRecordedCoverageSession({
                                ...fixture.request,
                                async execute() {
                                    throw new Error('Execution failed');
                                }
                            }, {
                                record: attempt.record,
                                session: {
                                    childProcess: null,
                                    async dispose() {
                                        throw new Error('Cleanup failed');
                                    },
                                    async finalize(result) {
                                        return result;
                                    }
                                }
                            });
                        }, { name: 'AggregateError', message: 'Execution and coverage cleanup failed.' });
                        return scope.assert.collect();
                    }
                );
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
