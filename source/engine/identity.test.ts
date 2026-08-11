import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { formatCaseId, type CaseId } from './identity.ts';

export const testSuite = createOverkillSuite({
    name: 'source/engine/identity.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'formatCaseId() renders direct engine identities for display',
            metadata: {},
            body(scope: OverkillScope) {
                const caseId: CaseId = {
                    file: null,
                    name: 'row 1',
                    params: null,
                    suite: [ 'root', 'rows' ]
                };

                scope.assert.equal(formatCaseId(caseId), 'root > rows > row 1');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'formatCaseId() renders origin and parameter slots when present',
            metadata: {},
            body(scope: OverkillScope) {
                const caseId: CaseId = {
                    file: 'source/users.test.ts',
                    name: 'round-trip',
                    params: 'seed=42',
                    suite: [ 'users' ]
                };

                scope.assert.equal(formatCaseId(caseId), 'source/users.test.ts: users > round-trip [seed=42]');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
