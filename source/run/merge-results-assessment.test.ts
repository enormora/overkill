import { suite, test } from '@overkill-dev/test';

import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { recordedRunResult } from './run-record-result.ts';
import { assessMergeSources } from './merge-results-assessment.ts';

const observed = runResultFactory.build({ perTest: [ {} ] });

export const testNode = suite('merge assessment', [
    test('retains duplicate logical outcomes', function (scope) {
        const result = recordedRunResult({
            ...observed,
            perTest: observed.perTest.map(function retry(testResult) {
                return {
                    ...testResult,
                    attempts: [ testResult.attempts[0], { ...testResult.attempts[0], attempt: { index: 1 } } ]
                };
            })
        });
        const first = mergeRecordFixture('first', 1, 1);
        const source = {
            path: 'first.json',
            record: { ...first, result: { ...first.result, perTest: result.perTest } }
        };
        const single = assessMergeSources({ sources: [ source ], errors: [] });
        scope.assert.equal(
            single.errors.some(function duplicate(error) {
                return error.message.includes('Duplicate executed');
            }),
            false
        );
        const second = {
            path: 'second.json',
            record: { ...source.record, id: 'second', facts: mergeRecordFixture('second', 2, 1).facts }
        };
        const duplicated = assessMergeSources({ sources: [ source, second ], errors: [] });
        scope.assert.equal(duplicated.sources.length, 2);
        scope.assert.equal(
            duplicated.errors.some(function duplicate(error) {
                return error.message.includes('Duplicate executed');
            }),
            true
        );
        return scope.assert.collect();
    })
]);
