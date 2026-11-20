import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { ensureResourceDescriptor, ensureRuntimeGraph, readResourceMap } from './resource-wrapper-data.ts';

export const testNode: TestNode = suite('resource wrapper input admission', [
    table({
        title: 'rejects incomplete resource descriptor',
        cases: [ null, 42, {}, { name: 'resource', scope: 'run' } ],
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const value = scope.parameters;

            scope.assert.throws(function () {
                ensureResourceDescriptor(value, 'invalid resource');
            }, { message: 'invalid resource' });
            return scope.assert.collect();
        }
    }),
    test('rejects an unbranded runtime graph', function (scope) {
        scope.assert.throws(function () {
            ensureRuntimeGraph({ kind: 'runtime', name: 'runtime', resources: [] }, 'invalid runtime');
        }, { message: 'invalid runtime' });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid resource map',
        cases: [ null, {}, { invalid: 42 } ],
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const value = scope.parameters;

            scope.assert.throws(function () {
                readResourceMap(value, 'invalid map');
            }, { message: 'invalid map' });
            return scope.assert.collect();
        }
    })
]);
