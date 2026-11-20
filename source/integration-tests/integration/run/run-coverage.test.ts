import { type TestNode, suite, test } from '@overkill-dev/test';
import { runInNewContext } from 'node:vm';

import { runResultFactory } from '../../../test-support/run-result-factory.ts';
import { withCoverageRecordFixture } from '../../../test-support/coverage-record-fixture.ts';
import { defaultRunConfig, defaultIntegrationProfile } from '../../../test-support/run-command-factory.ts';
import { createCoverageRunRecord } from '../../../run/coverage-run-record.ts';
import { createCoverageSession } from '../../../run/coverage-session.ts';
import { createRunTimingMeasurement } from '../../../run/run-timing-collection.ts';
import {
    coverageExecutionCompleted,
    microtestCoveragePolicy,
    startCoverageSession
} from '../../../run/run-coverage.ts';

async function withCoverageEnvironment<Value>(work: () => Promise<Value>): Promise<Value> {
    const environment: Record<string, string | undefined> = Reflect.get(process, 'env');
    const previous = environment.NODE_V8_COVERAGE;
    Reflect.set(environment, 'NODE_V8_COVERAGE', 'previous-coverage-root');
    try {
        return await work();
    } finally {
        if (previous === undefined) {
            Reflect.deleteProperty(environment, 'NODE_V8_COVERAGE');
        } else {
            Reflect.set(environment, 'NODE_V8_COVERAGE', previous);
        }
    }
}

export const testNode: TestNode = suite('Run coverage', [
    test(
        'disposing a coverage session before start preserves the previous coverage environment',
        async function (scope) {
            return await withCoverageEnvironment(async function preserveCoverageEnvironment() {
                return await withCoverageRecordFixture(
                    defaultRunConfig(),
                    [],
                    async function verifyEnvironment(fixture) {
                        const attempt = await createCoverageRunRecord(
                            process.cwd(),
                            fixture.request.input,
                            fixture.request.dependencies,
                            null
                        );
                        const session = await createCoverageSession(attempt.sessionRequest);
                        await session.dispose();
                        const environment: Record<string, string | undefined> = Reflect.get(process, 'env');
                        scope.assert.equal(environment.NODE_V8_COVERAGE, 'previous-coverage-root');
                        return scope.assert.collect();
                    }
                );
            });
        }
    ),
    test('rejects integration profiles', function (scope) {
        scope.assert.throws(function integrationCoverage() {
            microtestCoveragePolicy(defaultIntegrationProfile({}));
        }, { message: 'Coverage policy requires a microtest profile.' });
        return scope.assert.collect();
    }),
    test('coverage setup classifies start errors from another realm', async function (scope) {
        return await withCoverageRecordFixture(
            defaultRunConfig(),
            [],
            async function verifySetupFailure(fixture) {
                const timing = createRunTimingMeasurement(fixture.request.dependencies.wallClock);
                const attempt = await createCoverageRunRecord(
                    process.cwd(),
                    fixture.request.input,
                    fixture.request.dependencies,
                    timing
                );
                await scope.assert.rejects(async function failCoverageStart() {
                    await startCoverageSession({
                        ...attempt.sessionRequest,
                        timing: {
                            ...timing,
                            async measureAsync() {
                                const error = runInNewContext('new Error("Coverage start failed")') as Error;
                                throw error;
                            }
                        }
                    });
                }, { message: 'Coverage setup failed.' });
                return scope.assert.collect();
            }
        );
    }),
    test(
        'supervised coverage tolerates repeated starts and disposal without reporting interrupted execution',
        async function (scope) {
            return await withCoverageRecordFixture(defaultRunConfig(), [], async function verifyLifecycle(fixture) {
                const timing = createRunTimingMeasurement(fixture.request.dependencies.wallClock);
                const attempt = await createCoverageRunRecord(
                    process.cwd(),
                    fixture.request.input,
                    fixture.request.dependencies,
                    timing
                );
                const session = await createCoverageSession(attempt.sessionRequest);
                const result = runResultFactory.build({ summary: { crashed: 1 } });
                await session.start();
                await session.start();
                scope.assert.equal(await session.finalize(result, false), result);
                await session.dispose();
                await session.dispose();
                return scope.assert.collect();
            });
        }
    ),
    test('coverageExecutionCompleted() rejects interrupted runs', function (scope) {
        scope.assert.true(coverageExecutionCompleted(runResultFactory.build()));
        scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
            summary: { crashed: 1 }
        })));
        scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
            summary: { processExhausted: 1 }
        })));
        scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
            runnerErrors: [ { subtype: 'crash' } ]
        })));
        scope.assert.true(coverageExecutionCompleted(runResultFactory.build({
            runnerErrors: [ { subtype: 'runtime-state' } ]
        })));

        return scope.assert.collect();
    })
]);
