import { type TestNode, table, suite } from '@overkill-dev/test';

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
export const testNode: TestNode = suite('authoring data validation', [
    table({
        title: 'rejects invalid annotation input',
        cases: invalidAnnotations,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const value = scope.parameters;

            scope.assert.throws(function () {
                readAuthoringAnnotations(value);
            }, { type: TypeError });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid control input',
        cases: invalidControls,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const value = scope.parameters;

            scope.assert.throws(function () {
                readAuthoringControls(value);
            }, { type: TypeError });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid facade input',
        cases: [ null, [], { mapScope: 42 }, { annotations: null }, { controls: null } ],
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const value = scope.parameters;

            scope.assert.throws(function () {
                Reflect.apply(readTestFacadeDefinition, undefined, [ value ]);
            }, { type: TypeError });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'retains duplicate execution controls',
        cases: [ 'forbidden', 'idempotent' ] as const,
        caseTitle(duplicateExecution) {
            return `${duplicateExecution}`;
        },
        test(scope) {
            const duplicateExecution = scope.parameters;

            scope.assert.deepEqual(readAuthoringControls({ duplicateExecution }), { duplicateExecution });
            scope.assert.deepEqual(createAuthoringControls({ duplicateExecution }, {}), { duplicateExecution });
            scope.assert.deepEqual(
                createAuthoringControls({ duplicateExecution: 'forbidden' }, { duplicateExecution }),
                { duplicateExecution }
            );
            return scope.assert.collect();
        }
    })
]);
