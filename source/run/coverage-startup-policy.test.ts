import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { coverageStartup } from '../test-support/coverage-startup.ts';
import { coverageCollectionRequest } from '../test-support/coverage-collection-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { defaultMicrotestProfile, defaultIntegrationProfile } from '../test-support/run-command-factory.ts';
import { testNode as paths } from './coverage-path-storage-policy.test.ts';
import { openCoverageSession, coverageExecutionCompleted, microtestCoveragePolicy } from './run-coverage.ts';

export const testNode = suite('coverage startup and completion policy', [
    paths,
    test('starts an acquired session before returning ownership', async function (scope: TestScope) {
        const fixture = coverageStartup(null, null, null);
        const session = await openCoverageSession(coverageCollectionRequest, fixture.load);
        scope.assert.equal(session, fixture.session);
        scope.assert.deepEqual(fixture.calls, [ 'load', 'start' ]);
        scope.assert.deepEqual(fixture.requests, [ coverageCollectionRequest ]);
        return scope.assert.collect();
    }),
    ...([ new Error('setup failed'), 'non-error' ] as const).map(function (failure) {
        return test(`wraps factory setup failure ${String(failure)}`, async function (scope: TestScope) {
            const fixture = coverageStartup(failure, null, null);
            await scope.assert.rejects(async function () {
                await openCoverageSession(coverageCollectionRequest, fixture.load);
            }, {
                name: 'RunCollectionError',
                message: failure instanceof Error ? 'Coverage setup failed: setup failed' : 'Coverage setup failed.'
            });
            scope.assert.deepEqual(fixture.calls, [ 'load' ]);
            return scope.assert.collect();
        });
    }),
    ...([ null, new Error('cleanup failed') ] as const).map(function (disposeFailure) {
        return test(
            `disposes failed startup while retaining its original cause with cleanup ${String(disposeFailure)}`,
            async function (scope: TestScope) {
                const fixture = coverageStartup(null, new Error('startup failed'), disposeFailure);
                await scope.assert.rejects(async function () {
                    await openCoverageSession(coverageCollectionRequest, fixture.load);
                }, { name: 'RunCollectionError', message: 'Coverage setup failed: startup failed' });
                scope.assert.deepEqual(fixture.calls, [ 'load', 'start', 'dispose' ]);
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'crash', 'loader', 'process-exhaustion', 'reporter', 'coverage' ] as const).map(function (subtype) {
        return test(`classifies coverage completeness for ${subtype} errors`, function (scope: TestScope) {
            const result = runResultFactory.build({ runnerErrors: [ { subtype, message: 'failed' } ] });
            scope.assert.equal(coverageExecutionCompleted(result), subtype === 'coverage' || subtype === 'reporter');
            return scope.assert.collect();
        });
    }),
    test('does not call crashed or exhausted execution complete', function (scope: TestScope) {
        scope.assert.false(coverageExecutionCompleted(runResultFactory.build({ summary: { crashed: 1 } })));
        scope.assert.false(coverageExecutionCompleted(runResultFactory.build({ summary: { processExhausted: 1 } })));
        scope.assert.true(coverageExecutionCompleted(runResultFactory.build()));
        return scope.assert.collect();
    }),
    test('selects unit coverage and rejects other test families', function (scope: TestScope) {
        const profile = defaultMicrotestProfile({});
        scope.assert.equal(microtestCoveragePolicy(profile), profile.coverage);
        scope.assert.throws(function () {
            microtestCoveragePolicy(defaultIntegrationProfile({}));
        }, { message: 'Coverage policy requires a microtest profile.' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
