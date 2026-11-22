import { table, suite, test } from '@overkill-dev/test';

import { ensureResourceDescriptor, ensureRuntimeGraph, readResourceMap } from './resource-wrapper-data.ts';

export const testNode = suite('resource wrapper input admission', [
    table({
        title: 'rejects incomplete resource descriptor',
        cases: [ { description: 'null', input: null }, { description: 'number', input: 42 }, {
            description: 'empty descriptor',
            input: {}
        }, { description: 'unsupported lifetime', input: { name: 'resource', scope: 'run' } } ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const value = scope.parameters.input;

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
        cases: [ { description: 'null', input: null }, { description: 'empty map', input: {} }, {
            description: 'numeric descriptor',
            input: { invalid: 42 }
        } ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const value = scope.parameters.input;

            scope.assert.throws(function () {
                readResourceMap(value, 'invalid map');
            }, { message: 'invalid map' });
            return scope.assert.collect();
        }
    })
]);
