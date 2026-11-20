import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { campaignFrameChannel } from '../../test-support/campaign-frame-channel.ts';

const expectedMessages = {
    'body-string': 'Campaign transport requires binary frames.',
    'header-string': 'Campaign transport requires binary frames.',
    'large-header': 'Invalid campaign frame size.',
    'receiver-failure': 'Invalid campaign frame.',
    'zero-header': 'Invalid campaign frame size.'
};
export const testNode = authoredSuite(
    'campaign frame admission',
    ([ 'body-string', 'header-string', 'large-header', 'receiver-failure', 'zero-header' ] as const).map(
        function (scenario) {
            return test(`closes malformed ${scenario} campaign traffic`, async function (scope: TestScope) {
                const fixture = campaignFrameChannel(scenario);
                fixture.deliver();
                const error = await fixture.fault;
                scope.assert.true(fixture.socket.destroyed);
                scope.assert.equal(error.message, expectedMessages[scenario]);
                scope.assert.equal(error.cause, scenario === 'receiver-failure' ? 'receiver failed' : undefined);
                return scope.assert.collect();
            });
        }
    )
);
