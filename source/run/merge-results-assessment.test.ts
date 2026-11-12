import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { recordedRunResult } from './run-record-result.ts';
import { assessMergeSources } from './merge-results-assessment.ts';

const observed = runResultFactory.build({ perTest: [ {} ] });

export const testNode = createSuite({
    title: 'merge assessment',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            title: 'retains duplicate logical outcomes',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                const result = recordedRunResult({
                    ...observed,
                    perTest: observed.perTest.map(function retry(test) {
                        return {
                            ...test,
                            attempts: [ test.attempts[0], { ...test.attempts[0], attempt: { index: 1 } } ]
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
            }
        })
    ]
});
await runIfMain(import.meta, testNode);
