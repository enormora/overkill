import { runInNewContext } from 'node:vm';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { withCoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { defaultRunConfig, defaultIntegrationProfile } from '../test-support/run-command-factory.ts';
import { createCoverageRunRecord } from './coverage-run-record.ts';
import { createCoverageSession } from './coverage-session.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import { coverageExecutionCompleted, microtestCoveragePolicy, startCoverageSession } from './run-coverage.ts';

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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-coverage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'disposing a coverage session before start preserves the previous coverage environment',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'coverage policy rejects integration profiles',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function integrationCoverage() {
                    microtestCoveragePolicy(defaultIntegrationProfile({}));
                }, { message: 'Coverage policy requires a microtest profile.' });
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'coverage setup classifies start errors from another realm',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'supervised coverage tolerates repeated starts and disposal without reporting interrupted execution',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'coverageExecutionCompleted() rejects interrupted runs',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.true(coverageExecutionCompleted(runResultFactory.build()));
                scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
                    summary: { crashed: 1 }
                })));
                scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
                    summary: { resourceExhausted: 1 }
                })));
                scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
                    runnerErrors: [ { subtype: 'crash' } ]
                })));
                scope.assert.true(coverageExecutionCompleted(runResultFactory.build({
                    runnerErrors: [ { subtype: 'runtime-state' } ]
                })));

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
