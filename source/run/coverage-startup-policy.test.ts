import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { coverageStartup } from '../test-support/coverage-startup.ts';
import { coverageCollectionRequest } from '../test-support/coverage-collection-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { defaultMicrotestProfile, defaultIntegrationProfile } from '../test-support/run-command-factory.ts';

import { openCoverageSession, coverageExecutionCompleted, microtestCoveragePolicy } from './run-coverage.ts';

export const testNode: TestNode = suite('coverage startup and completion policy', [
    test('starts an acquired session before returning ownership', async function (scope) {
        const fixture = coverageStartup(null, null, null);
        const session = await openCoverageSession(coverageCollectionRequest, fixture.load);
        scope.assert.equal(session, fixture.session);
        scope.assert.deepEqual(fixture.calls, [ 'load', 'start' ]);
        scope.assert.deepEqual(fixture.requests, [ coverageCollectionRequest ]);
        return scope.assert.collect();
    }),
    table({
        title: 'wraps factory setup failures',
        cases: [ new Error('setup failed'), 'non-error' ] as const,
        caseTitle(failure) {
            return `${String(failure)}`;
        },
        async test(scope) {
            const failure = scope.parameters;

            const fixture = coverageStartup(failure, null, null);
            await scope.assert.rejects(async function () {
                await openCoverageSession(coverageCollectionRequest, fixture.load);
            }, {
                name: 'RunCollectionError',
                message: failure instanceof Error ? 'Coverage setup failed: setup failed' : 'Coverage setup failed.'
            });
            scope.assert.deepEqual(fixture.calls, [ 'load' ]);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'retains startup causes when disposal also fails',
        cases: [ null, new Error('cleanup failed') ] as const,
        caseTitle(disposeFailure) {
            return `${String(disposeFailure)}`;
        },
        async test(scope) {
            const disposeFailure = scope.parameters;

            const fixture = coverageStartup(null, new Error('startup failed'), disposeFailure);
            await scope.assert.rejects(async function () {
                await openCoverageSession(coverageCollectionRequest, fixture.load);
            }, { name: 'RunCollectionError', message: 'Coverage setup failed: startup failed' });
            scope.assert.deepEqual(fixture.calls, [ 'load', 'start', 'dispose' ]);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'classifies coverage completeness from runner errors',
        cases: [ 'crash', 'loader', 'process-exhaustion', 'reporter', 'coverage' ] as const,
        caseTitle(subtype) {
            return `${subtype}`;
        },
        test(scope) {
            const subtype = scope.parameters;

            const result = runResultFactory.build({ runnerErrors: [ { subtype, message: 'failed' } ] });
            scope.assert.equal(coverageExecutionCompleted(result), subtype === 'coverage' || subtype === 'reporter');
            return scope.assert.collect();
        }
    }),
    test('does not call crashed or exhausted execution complete', function (scope) {
        scope.assert.false(coverageExecutionCompleted(runResultFactory.build({ summary: { crashed: 1 } })));
        scope.assert.false(coverageExecutionCompleted(runResultFactory.build({ summary: { processExhausted: 1 } })));
        scope.assert.true(coverageExecutionCompleted(runResultFactory.build()));
        return scope.assert.collect();
    }),
    test('selects unit coverage and rejects other test families', function (scope) {
        const profile = defaultMicrotestProfile({});
        scope.assert.equal(microtestCoveragePolicy(profile), profile.coverage);
        scope.assert.throws(function () {
            microtestCoveragePolicy(defaultIntegrationProfile({}));
        }, { message: 'Coverage policy requires a microtest profile.' });
        return scope.assert.collect();
    })
]);
