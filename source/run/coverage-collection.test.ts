import { type TestScope, suite as authoredSuite, test as authoredTest, testDouble } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { exchangedAttachment } from '../test-support/attachment-exchange.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    coverageCollectionFixture,
    coverageCollectionRequest as request,
    coverageCollectionReport
} from '../test-support/coverage-collection-fixture.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import { createCoverageCollection } from './coverage-collection.ts';

export const testNode = authoredSuite('coverage collection lifecycle', [
    ...[ false, true ].map(function (empty) {
        return authoredTest(
            `accepts covered thresholds for an empty report ${empty}`,
            async function (scope: TestScope) {
                const fixture = coverageCollectionFixture([], undefined);
                const metric = { covered: 0, total: 0 };
                const report = empty
                    ? { ...coverageCollectionReport, summary: { lines: metric, functions: metric, branches: metric } }
                    : coverageCollectionReport;
                const session = await createCoverageCollection({
                    ...request,
                    coverage: { ...request.coverage, thresholds: { lines: 50, functions: 50, branches: 50 } }
                }, {
                    ...fixture.runtime,
                    async report() {
                        return report;
                    }
                });
                const result = await session.finalize(
                    runResultFactory.build({ summary: { planned: 1, passed: 1 } }),
                    true
                );
                scope.assert.equal(result.status, 'passed');
                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.equal(result.artifacts.length, 1);
                return scope.assert.collect();
            }
        );
    }),
    authoredTest(
        'reports non-error failures without inventing a native error message',
        async function (scope: TestScope) {
            const fixture = coverageCollectionFixture([], undefined);
            const session = await createCoverageCollection(request, {
                ...fixture.runtime,
                async report() {
                    return testDouble.throws(42)();
                }
            });
            const result = await session.finalize(runResultFactory.build(), true);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.runnerErrors[0]?.message, 'Coverage failed.');
            scope.assert.partialDeepEqual(result.runnerErrors[0]?.cause, {
                error: 42,
                kind: 'coverage-operation',
                phase: 'report'
            });
            return scope.assert.collect();
        }
    ),
    authoredTest('records coverage timing spans through the supplied clock', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], undefined);
        const timing = createRunTimingMeasurement(createDeterministicClock({ initialUnixEpochMicroseconds: 0n }));
        const session = await createCoverageCollection({ ...request, timing }, fixture.runtime);
        await session.start();
        await session.finalize(runResultFactory.build(), true);
        scope.assert.deepEqual(
            timing.report().spans.map(function (span) {
                return span.kind;
            }),
            [ 'coverage.start', 'coverage.collect', 'coverage.report' ]
        );
        return scope.assert.collect();
    }),
    authoredTest('keeps run artifact sequences independent of case artifacts', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], undefined);
        const session = await createCoverageCollection(request, fixture.runtime);
        const id = { file: 'case.ts', params: null, suite: [], title: 'case' };
        const artifact = {
            ...exchangedAttachment,
            id: {
                ...exchangedAttachment.id,
                sequence: 42,
                attempt: { index: 0 },
                scope: { kind: 'case' as const, case: id, activeCases: [ id ], confidence: 'active-case' as const }
            }
        };
        const result = await session.finalize(runResultFactory.build({ artifacts: [ artifact ] }), true);
        scope.assert.equal(result.artifacts[1]?.id.sequence, 0);
        scope.assert.equal(result.artifacts[0], artifact);
        return scope.assert.collect();
    }),

    authoredTest(
        'starts once and restores the previous coverage environment after collection',
        async function (scope: TestScope) {
            const fixture = coverageCollectionFixture([], 'previous');
            const session = await createCoverageCollection(request, fixture.runtime);
            await session.start();
            await session.start();
            scope.assert.equal(fixture.environment.NODE_V8_COVERAGE, request.paths.rawDataDirectory);
            await session.finalize(runResultFactory.build(), true);
            await session.dispose();
            scope.assert.deepEqual(fixture.commands, [
                'paths',
                'connect',
                'enable',
                'start',
                'take',
                'write',
                'stop',
                'disable',
                'disconnect',
                'report'
            ]);
            scope.assert.deepEqual({ directory: fixture.environment.NODE_V8_COVERAGE, writes: fixture.writes }, {
                directory: 'previous',
                writes: [ { result: [], timestamp: 1 } ]
            });
            return scope.assert.collect();
        }
    ),
    authoredTest('appends relative coverage evidence after existing run artifacts', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], undefined);
        const session = await createCoverageCollection(request, fixture.runtime);
        await session.start();
        const result = await session.finalize(runResultFactory.build({ artifacts: [ exchangedAttachment ] }), true);
        scope.assert.deepEqual(result.artifacts, [ exchangedAttachment, {
            id: {
                familyVariant: null,
                attempt: null,
                runtimes: [],
                scope: { kind: 'run' },
                sequence: 2,
                subtype: 'coverage',
                workload: null
            },
            source: 'v8-native',
            payload: {
                completeness: 'complete',
                directory: 'coverage',
                kind: 'coverage',
                rawDataDirectory: 'coverage/raw',
                reports: [ { format: 'lcov', path: 'coverage/lcov.info' } ],
                summary: coverageCollectionReport.summary
            }
        } ]);
        scope.assert.false(Object.hasOwn(fixture.environment, 'NODE_V8_COVERAGE'));
        return scope.assert.collect();
    }),
    authoredTest('supplies loaded-source exclusions and configured report outputs', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], undefined);
        const session = await createCoverageCollection({
            ...request,
            coverage: { ...request.coverage, sources: { mode: 'loaded', exclude: [ '**/*.test.ts' ] } }
        }, fixture.runtime);
        await session.finalize(runResultFactory.build(), true);
        const report = fixture.reports[0];
        scope.require.defined(report);
        scope.assert.deepEqual(report.sourceScope, {
            mode: 'loaded',
            exclude: [ '**/*.test.ts' ],
            excludedFiles: new Set(request.testFiles)
        });
        scope.assert.deepEqual(report.outputs, request.coverage.outputs);
        return scope.assert.collect();
    }),
    authoredTest('supplies all-source inclusion patterns', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], undefined);
        const session = await createCoverageCollection({
            ...request,
            coverage: { ...request.coverage, sources: { mode: 'all', include: [ 'source/**/*.ts' ], exclude: [] } }
        }, fixture.runtime);
        await session.finalize(runResultFactory.build(), true);
        const report = fixture.reports[0];
        scope.require.defined(report);
        scope.assert.deepEqual(report.sourceScope, {
            mode: 'all',
            include: [ 'source/**/*.ts' ],
            exclude: [],
            excludedFiles: new Set(request.testFiles)
        });
        return scope.assert.collect();
    }),
    authoredTest('leaves the caller result intact after incomplete execution', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], undefined);
        const session = await createCoverageCollection(request, fixture.runtime);
        await session.start();
        const expected = runResultFactory.build();
        scope.assert.equal(await session.finalize(expected, false), expected);
        scope.assert.deepEqual(fixture.reports, []);
        scope.assert.false(Object.hasOwn(fixture.environment, 'NODE_V8_COVERAGE'));
        return scope.assert.collect();
    }),
    authoredTest('configures child coverage without starting a local profiler', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], 'previous');
        const session = await createCoverageCollection(
            { ...request, processModel: 'supervised-process' },
            fixture.runtime
        );
        await session.start();
        await session.finalize(runResultFactory.build(), true);
        scope.assert.deepEqual(fixture.commands, [ 'paths', 'report' ]);
        const childCoverage = session.childProcess;
        scope.require.defined(childCoverage);
        scope.assert.deepEqual(childCoverage, {
            environment: { NODE_DISABLE_COMPILE_CACHE: '1', NODE_V8_COVERAGE: request.paths.rawDataDirectory },
            writablePath: `${request.paths.rawDataDirectory}/*`
        });
        scope.assert.equal(fixture.environment.NODE_V8_COVERAGE, 'previous');
        return scope.assert.collect();
    }),
    authoredTest(
        'disposes a session before it starts without touching the profiler',
        async function (scope: TestScope) {
            const fixture = coverageCollectionFixture([], 'previous');
            const session = await createCoverageCollection(request, fixture.runtime);
            await session.dispose();
            await session.dispose();
            scope.assert.deepEqual(fixture.commands, [ 'paths' ]);
            scope.assert.equal(fixture.environment.NODE_V8_COVERAGE, 'previous');
            return scope.assert.collect();
        }
    ),
    authoredTest('disposes a started session once and restores its environment', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([], undefined);
        const session = await createCoverageCollection(request, fixture.runtime);
        await session.start();
        await session.dispose();
        await session.dispose();
        scope.assert.deepEqual(fixture.commands, [
            'paths',
            'connect',
            'enable',
            'start',
            'stop',
            'disable',
            'disconnect'
        ]);
        scope.assert.false(Object.hasOwn(fixture.environment, 'NODE_V8_COVERAGE'));
        return scope.assert.collect();
    }),
    ...[ 'connect', 'enable', 'start' ].map(function startupFailure(command) {
        return authoredTest(`preserves ${command} startup errors`, async function (scope: TestScope) {
            const fixture = coverageCollectionFixture([ command ], undefined);
            const session = await createCoverageCollection(request, fixture.runtime);
            await scope.assert.rejects(async function startCoverage() {
                await session.start();
            }, { message: `${command} failed` });
            await session.dispose();
            scope.assert.false(Object.hasOwn(fixture.environment, 'NODE_V8_COVERAGE'));
            return scope.assert.collect();
        });
    }),
    ...[ 'take', 'write', 'stop', 'disable' ].map(function collectionFailure(command) {
        return authoredTest(
            `reports ${command} collection errors and restores the environment`,
            async function (scope: TestScope) {
                const fixture = coverageCollectionFixture([ command ], 'previous');
                const session = await createCoverageCollection(request, fixture.runtime);
                await session.start();
                const result = await session.finalize(runResultFactory.build(), true);
                scope.assert.equal(result.status, 'failed');
                scope.assert.equal(result.runnerErrors[0]?.subtype, 'coverage');
                scope.assert.equal(result.runnerErrors[0]?.message, `Coverage failed: ${command} failed`);
                scope.assert.equal(fixture.environment.NODE_V8_COVERAGE, 'previous');
                scope.assert.deepEqual(fixture.reports, []);
                return scope.assert.collect();
            }
        );
    }),
    authoredTest('preserves report-generation failures after successful collection', async function (scope: TestScope) {
        const fixture = coverageCollectionFixture([ 'report' ], undefined);
        const session = await createCoverageCollection(request, fixture.runtime);
        await session.start();
        const result = await session.finalize(runResultFactory.build(), true);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.runnerErrors[0]?.message, 'Coverage failed: report failed');
        scope.assert.deepEqual(result.artifacts, []);
        return scope.assert.collect();
    }),
    authoredTest(
        'reports every failed threshold without discarding collected evidence',
        async function (scope: TestScope) {
            const fixture = coverageCollectionFixture([], undefined);
            const session = await createCoverageCollection({
                ...request,
                coverage: { ...request.coverage, thresholds: { lines: 90, functions: 90, branches: 90 } }
            }, fixture.runtime);
            const result = await session.finalize(runResultFactory.build(), true);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.artifacts.length, 1);
            const error = result.runnerErrors[0];
            scope.require.defined(error);
            scope.assert.deepEqual(error.diagnostics, [
                { label: 'Coverage lines', value: '66.67% is below 90%' },
                { label: 'Coverage functions', value: '50% is below 90%' },
                { label: 'Coverage branches', value: '75% is below 90%' }
            ]);
            return scope.assert.collect();
        }
    )
]);
