import { suite, test } from '@overkill-dev/test';

import { formatCaseId, runtimeIdentityKey, type CaseId } from './identity.ts';

export const testNode = suite('Identity', [
    test('formatCaseId() renders direct engine identities for display', function (scope) {
        const caseId: CaseId = {
            file: null,
            title: 'row 1',
            params: null,
            suite: [ 'root', 'rows' ]
        };

        scope.assert.equal(formatCaseId(caseId), 'root > rows > row 1');

        return scope.assert.collect();
    }),
    test('formatCaseId() renders origin and parameter slots when present', function (scope) {
        const caseId: CaseId = {
            file: 'source/users.test.ts',
            title: 'round-trip',
            params: 'seed=42',
            suite: [ 'users' ]
        };

        scope.assert.equal(formatCaseId(caseId), 'source/users.test.ts: users > round-trip [seed=42]');

        return scope.assert.collect();
    }),
    test('runtimeIdentityKey() canonicalizes and distinguishes scenario bindings', function (scope) {
        const first = runtimeIdentityKey({
            dimensions: { node: '26' },
            name: 'api',
            scenarios: { database: 'empty', api: 'payments-500' },
            variantId: null
        });
        const reordered = runtimeIdentityKey({
            dimensions: { node: '26' },
            name: 'api',
            scenarios: { api: 'payments-500', database: 'empty' },
            variantId: null
        });
        const changed = runtimeIdentityKey({
            dimensions: { node: '26' },
            name: 'api',
            scenarios: { api: 'default', database: 'empty' },
            variantId: null
        });

        scope.assert.equal(first, reordered);
        scope.assert.notEqual(first, changed);

        return scope.assert.collect();
    })
]);
