import { type TestNode, table, suite } from '@overkill-dev/test';

import { bodyParticipant } from '../test-support/body-participant.ts';

export const testNode: TestNode = suite(
    'referenced body participant admission',
    [ table({
        title: 'readmits bodies without losing execution mode',
        cases: [ 'builder', 'throwing' ] as const,
        caseTitle(mode) {
            return `${mode}`;
        },
        async test(scope) {
            const mode = scope.parameters;

            const fixture = bodyParticipant(mode);
            scope.assert.equal(await fixture.bind(), 42);
            scope.assert.equal(await fixture.rebind(), 43);
            scope.assert.equal(fixture.participants[0]?.role, 'body');
            scope.assert.partialDeepEqual(fixture.executions, [ { kind: 'body', bodyMode: mode }, {
                kind: 'body',
                bodyMode: mode
            } ]);
            return scope.assert.collect();
        }
    }) ]
);
