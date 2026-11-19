import { suite, test as authoredTest } from '@overkill-dev/test';

import type { TestScope } from './test.entry-point.ts';
import { ensureResourceDescriptor, ensureRuntimeGraph, readResourceMap } from './resource-wrapper-data.ts';

export const testNode = suite('resource wrapper input admission', [
    ...[ null, 42, {}, { name: 'resource', scope: 'run' } ].map(function (value, index) {
        return authoredTest(`rejects incomplete resource descriptor ${index}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                ensureResourceDescriptor(value, 'invalid resource');
            }, { message: 'invalid resource' });
            return scope.assert.collect();
        });
    }),
    authoredTest('rejects an unbranded runtime graph', function (scope: TestScope) {
        scope.assert.throws(function () {
            ensureRuntimeGraph({ kind: 'runtime', name: 'runtime', resources: [] }, 'invalid runtime');
        }, { message: 'invalid runtime' });
        return scope.assert.collect();
    }),
    ...[ null, {}, { invalid: 42 } ].map(function (value, index) {
        return authoredTest(`rejects invalid resource map ${index}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                readResourceMap(value, 'invalid map');
            }, { message: 'invalid map' });
            return scope.assert.collect();
        });
    })
]);
