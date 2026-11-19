import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { bodyParticipant } from '../test-support/body-participant.ts';
import { testNode as forwarding } from './body-forwarding-policy.test.ts';

export const testNode = authoredSuite(
    'referenced body participant admission',
    [
        forwarding,
        ...([ 'builder', 'throwing' ] as const).map(function (mode) {
            return test(
                `binds and readmits ${mode} bodies without losing their execution mode`,
                async function (scope: TestScope) {
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
            );
        })
    ]
);
