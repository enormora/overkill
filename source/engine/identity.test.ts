import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { formatCaseId, type CaseId } from './identity.ts';

registerTest('formatCaseId() renders direct engine identities for display', function () {
    const caseId: CaseId = {
        file: null,
        name: 'row 1',
        params: null,
        suite: [ 'root', 'rows' ]
    };

    assert.equal(formatCaseId(caseId), 'root > rows > row 1');
});

registerTest('formatCaseId() renders origin and parameter slots when present', function () {
    const caseId: CaseId = {
        file: 'source/users.test.ts',
        name: 'round-trip',
        params: 'seed=42',
        suite: [ 'users' ]
    };

    assert.equal(formatCaseId(caseId), 'source/users.test.ts: users > round-trip [seed=42]');
});
