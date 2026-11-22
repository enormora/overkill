import { suite, test } from '@overkill-dev/test';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createCommandLineErrorResultFromUnknown, readExitCodeFromRunResult } from './command-line-command.ts';
import { RunCollectionError, RunResolutionError } from './run-errors.ts';

export const testNode = suite('CLI error results', [
    test('maps no tests collected errors', function (scope) {
        const result = createCommandLineErrorResultFromUnknown(
            new RunResolutionError('No explicit run paths were provided.', undefined, 'no-tests-collected')
        );

        scope.assert.equal(result.exitCode, 4);
        scope.assert.deepEqual(result.fallbackDiagnostics, [
            'Overkill no tests collected: No explicit run paths were provided.'
        ]);

        return scope.assert.collect();
    }),
    test('maps collection errors', function (scope) {
        const result = createCommandLineErrorResultFromUnknown(
            new RunCollectionError('Collection failed.', { cause: null }, 'loader')
        );

        scope.assert.equal(result.exitCode, 2);
        scope.assert.deepEqual(result.fallbackDiagnostics, [
            'Overkill runner error: Collection failed.'
        ]);
        scope.assert.deepEqual(result.stdoutLines, []);

        return scope.assert.collect();
    }),
    test('readExitCodeFromRunResult() allows empty shards', function (scope) {
        scope.assert.equal(
            readExitCodeFromRunResult(runResultFactory.build({
                planStatus: 'empty-shard',
                summary: { planned: 0 }
            })),
            0
        );
        scope.assert.equal(
            readExitCodeFromRunResult(runResultFactory.build({
                planStatus: 'empty-selection',
                summary: { planned: 0 }
            })),
            4
        );

        return scope.assert.collect();
    }),
    test(
        'formats supplemental aggregate errors',
        function (scope) {
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
    ),
    test(
        'formats supplemental runner errors',
        function (scope) {
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
    ),
    test(
        'keeps malformed supplemental errors internal',
        function (scope) {
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
    ),
    test(
        'falls back to the aggregate message',
        function (scope) {
            const aggregateError = new AggregateError([], 'aggregate failure');
            Object.defineProperty(aggregateError, 'errors', { value: 'not-an-array' });
            const result = createCommandLineErrorResultFromUnknown(aggregateError);

            scope.assert.equal(result.exitCode, 70);
            scope.assert.deepEqual(result.fallbackDiagnostics, [
                'Overkill internal error: aggregate failure'
            ]);

            return scope.assert.collect();
        }
    )
]);
