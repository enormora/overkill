import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { formatCaseId, type CaseId } from './identity.ts';

export const testSuite = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/engine/identity.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'formatCaseId() renders direct engine identities for display',
            metadata: {},
            body(scope: OverkillScope) {
                const caseId: CaseId = {
                    file: null,
                    title: 'row 1',
                    params: null,
                    suite: [ 'root', 'rows' ]
                };

                scope.assert.equal(formatCaseId(caseId), 'root > rows > row 1');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'formatCaseId() renders origin and parameter slots when present',
            metadata: {},
            body(scope: OverkillScope) {
                const caseId: CaseId = {
                    file: 'source/users.test.ts',
                    title: 'round-trip',
                    params: 'seed=42',
                    suite: [ 'users' ]
                };

                scope.assert.equal(formatCaseId(caseId), 'source/users.test.ts: users > round-trip [seed=42]');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);
