import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { formatCaseId, type CaseId } from './identity.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/identity.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
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
            definitionLocations: [ { kind: 'unknown' as const } ],
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

await runTestFileIfMain(import.meta, testNode);
