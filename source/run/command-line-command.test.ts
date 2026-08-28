import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createCommandLineErrorResultFromUnknown } from './command-line-command.ts';
import { RunCollectionError, RunResolutionError } from './run-errors.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-command.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'createCommandLineErrorResultFromUnknown() maps no tests collected errors',
            metadata: {},
            body(scope: OverkillScope) {
                const result = createCommandLineErrorResultFromUnknown(
                    new RunResolutionError('No explicit run paths were provided.', undefined, 'no-tests-collected')
                );

                scope.assert.equal(result.exitCode, 4);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill no tests collected: No explicit run paths were provided.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createCommandLineErrorResultFromUnknown() maps collection errors',
            metadata: {},
            body(scope: OverkillScope) {
                const result = createCommandLineErrorResultFromUnknown(
                    new RunCollectionError('Collection failed.', { cause: null }, 'loader')
                );

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill runner error: Collection failed.'
                ]);
                scope.assert.deepEqual(result.stdoutLines, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createCommandLineErrorResultFromUnknown() formats supplemental aggregate errors',
            metadata: {},
            body(scope: OverkillScope) {
                const primaryError = new Error('primary failure');
                const result = createCommandLineErrorResultFromUnknown(
                    new AggregateError([ primaryError, 'supplemental failure' ], 'aggregate failure')
                );

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: primary failure',
                    'Overkill internal error: supplemental failure'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createCommandLineErrorResultFromUnknown() formats supplemental runner errors',
            metadata: {},
            body(scope: OverkillScope) {
                const primaryError = new Error('primary failure');
                const result = createCommandLineErrorResultFromUnknown(
                    new AggregateError([
                        primaryError,
                        {
                            attributedTo: null,
                            cause: null,
                            message: 'collection failure',
                            subtype: 'loader'
                        }
                    ], 'aggregate failure')
                );

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: primary failure',
                    'Overkill runner error: collection failure'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createCommandLineErrorResultFromUnknown() keeps malformed supplemental errors internal',
            metadata: {},
            body(scope: OverkillScope) {
                const primaryError = new Error('primary failure');
                const result = createCommandLineErrorResultFromUnknown(
                    new AggregateError([
                        primaryError,
                        null,
                        {
                            message: 404,
                            subtype: 'loader'
                        },
                        {
                            message: 'collection failure',
                            subtype: 404
                        }
                    ], 'aggregate failure')
                );

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: primary failure',
                    'Overkill internal error: null',
                    'Overkill internal error: [object Object]',
                    'Overkill internal error: [object Object]'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createCommandLineErrorResultFromUnknown() falls back to the aggregate message',
            metadata: {},
            body(scope: OverkillScope) {
                const aggregateError = new AggregateError([], 'aggregate failure');
                Object.defineProperty(aggregateError, 'errors', { value: 'not-an-array' });
                const result = createCommandLineErrorResultFromUnknown(aggregateError);

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: aggregate failure'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
