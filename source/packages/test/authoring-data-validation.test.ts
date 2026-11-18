import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from './test.entry-point.ts';
import {
    readAuthoringAnnotations,
    readAuthoringControls,
    readTestFacadeDefinition,
    createAuthoringControls
} from './authoring-test-data.ts';

const invalidAnnotations: readonly unknown[] = [
    null,
    [],
    'tags',
    { tags: 'tag' },
    { ownership: 42 },
    { tags: [ '' ] },
    { ownership: [ null ] },
    { tags: [ 'valid', ' ' ] }
];
const invalidControls: readonly unknown[] = [
    null,
    [],
    { capture: 'unknown' },
    { capture: 42 },
    { timeoutMilliseconds: Number.POSITIVE_INFINITY },
    { timeoutMilliseconds: '100' },
    { duplicateExecution: 'unknown' }
];
export const testNode = suite('authoring data validation', [
    ...invalidAnnotations.map(function (value, index) {
        return test(`rejects invalid annotation input ${index}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                readAuthoringAnnotations(value);
            }, { type: TypeError });
            return scope.assert.collect();
        });
    }),
    ...invalidControls.map(function (value, index) {
        return test(`rejects invalid control input ${index}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                readAuthoringControls(value);
            }, { type: TypeError });
            return scope.assert.collect();
        });
    }),
    ...[ null, [], { mapScope: 42 }, { annotations: null }, { controls: null } ].map(function (value, index) {
        return test(`rejects invalid facade input ${index}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                Reflect.apply(readTestFacadeDefinition, undefined, [ value ]);
            }, { type: TypeError });
            return scope.assert.collect();
        });
    }),
    ...([ 'forbidden', 'idempotent' ] as const).map(function (duplicateExecution) {
        return test(`retains ${duplicateExecution} duplicate execution controls`, function (scope: TestScope) {
            scope.assert.deepEqual(readAuthoringControls({ duplicateExecution }), { duplicateExecution });
            scope.assert.deepEqual(createAuthoringControls({ duplicateExecution }, {}), { duplicateExecution });
            scope.assert.deepEqual(
                createAuthoringControls({ duplicateExecution: 'forbidden' }, { duplicateExecution }),
                { duplicateExecution }
            );
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
