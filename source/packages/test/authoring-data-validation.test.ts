import { table, suite } from '@overkill-dev/test';

import {
    readAuthoringAnnotations,
    readAuthoringControls,
    readTestFacadeDefinition,
    createAuthoringControls
} from './authoring-test-data.ts';

export const testNode = suite('authoring data validation', [
    table({
        title: 'rejects invalid annotation input',
        cases: [
            { description: 'null', input: null },
            { description: 'array', input: [] },
            { description: 'string', input: 'tags' },
            { description: 'string tags', input: { tags: 'tag' } },
            { description: 'numeric ownership', input: { ownership: 42 } },
            { description: 'empty tag', input: { tags: [ '' ] } },
            { description: 'null owner', input: { ownership: [ null ] } },
            { description: 'blank tag', input: { tags: [ 'valid', ' ' ] } }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const value = scope.parameters.input;

            scope.assert.throws(function () {
                readAuthoringAnnotations(value);
            }, { type: TypeError });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid control input',
        cases: [
            { description: 'null', input: null },
            { description: 'array', input: [] },
            { description: 'unknown capture mode', input: { capture: 'unknown' } },
            { description: 'numeric capture mode', input: { capture: 42 } },
            { description: 'infinite timeout', input: { timeoutMilliseconds: Number.POSITIVE_INFINITY } },
            { description: 'string timeout', input: { timeoutMilliseconds: '100' } },
            { description: 'unknown duplicate policy', input: { duplicateExecution: 'unknown' } }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const value = scope.parameters.input;

            scope.assert.throws(function () {
                readAuthoringControls(value);
            }, { type: TypeError });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid facade input',
        cases: [
            { description: 'null', input: null },
            { description: 'array', input: [] },
            { description: 'non-callable scope mapper', input: { mapScope: 42 } },
            { description: 'null annotations', input: { annotations: null } },
            { description: 'null controls', input: { controls: null } }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const value = scope.parameters.input;

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
            return duplicateExecution;
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
