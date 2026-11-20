import { type TestScope, suite as authoredSuite, test as authoredTest, testDouble } from '@overkill-dev/test';

import { defineReporter } from '../packages/engine/engine.entry-point.ts';

import { createInMemoryFinalResultReporter } from '../reporters/in-memory-reporter.ts';
import { normalizeConfig } from '../config/config.ts';

import { defaultRunConfig, defaultRunRequest, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { testNode as support } from './run-support-policy.test.ts';
import { validateRunInput, assertProfileRequestSupported } from './run-validation.ts';

const command = { cwd: '/project', config: defaultRunConfig({}), engine: { kind: 'default' as const } };
const propertyProfile = normalizeConfig({
    profiles: { laws: { testFamily: 'property', files: { include: [ '**/*.test.ts' ], exclude: [] } } }
})
    .profiles
    .laws;
export const testNode = authoredSuite('run request validation boundaries', [
    authoredTest('rejects ordinary recording combined with merge recording', function (scope: TestScope) {
        scope.assert.throws(function () {
            validateRunInput({
                ...command,
                request: defaultRunRequest({ record: true, recordForMerge: true, shard: { index: 1, total: 2 } })
            });
        }, { message: 'Choose either --record or --record-for-merge.' });
        return scope.assert.collect();
    }),
    ...[ new Error('Reporter requirements failed.'), 'Reporter requirements failed.' ].map(function (failure, index) {
        return authoredTest(
            `classifies reporter requirement failure ${index} as an invalid request`,
            function (scope: TestScope) {
                const reporter = createInMemoryFinalResultReporter();
                const required = defineReporter({
                    createReporter: reporter,
                    validateRunFacts() {
                        testDouble.throws(failure)();
                    }
                });
                scope.assert.throws(function () {
                    assertProfileRequestSupported(defaultRunRequest({}), defaultMicrotestProfile({}), 'test', [
                        required
                    ]);
                }, { name: 'RunResolutionError', message: 'Reporter requirements failed.' });
                return scope.assert.collect();
            }
        );
    }),

    support,
    authoredTest('rejects merge recording without multiple shards', function (scope: TestScope) {
        scope.assert.throws(function () {
            validateRunInput({ ...command, request: defaultRunRequest({ recordForMerge: true }) });
        }, { message: '--record-for-merge requires more than one shard.' });
        return scope.assert.collect();
    }),
    authoredTest('rejects non-boolean recording input', function (scope: TestScope) {
        scope.assert.throws(function () {
            Reflect.apply(validateRunInput, undefined, [ {
                ...command,
                request: { ...defaultRunRequest({}), record: 'yes' }
            } ]);
        }, { message: 'Record must be a boolean.' });
        return scope.assert.collect();
    }),
    ...([ 'test', 'bench-calibrate' ] as const).map(function (namespace) {
        return authoredTest(`rejects baseline updates in the ${namespace} namespace`, function (scope: TestScope) {
            scope.assert.throws(function () {
                assertProfileRequestSupported(
                    defaultRunRequest({ baselineUpdateMode: 'update' }),
                    defaultMicrotestProfile({}),
                    namespace,
                    null
                );
            }, { message: 'Baseline updates and previews require baseline commands.' });
            return scope.assert.collect();
        });
    }),
    authoredTest('rejects live capture for property profiles', function (scope: TestScope) {
        scope.require.defined(propertyProfile);
        scope.assert.throws(function () {
            assertProfileRequestSupported(defaultRunRequest({ capture: 'live' }), propertyProfile, 'test', null);
        }, { message: 'Property profiles do not support live capture.' });
        return scope.assert.collect();
    })
]);
