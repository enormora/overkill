import { table, type TestNode, suite } from '@overkill-dev/test';

import { campaignFrameChannel } from '../../test-support/campaign-frame-channel.ts';

const expectedMessages = {
    'body-string': 'Campaign transport requires binary frames.',
    'header-string': 'Campaign transport requires binary frames.',
    'large-header': 'Invalid campaign frame size.',
    'receiver-failure': 'Invalid campaign frame.',
    'zero-header': 'Invalid campaign frame size.'
};
export const testNode: TestNode = suite(
    'campaign frame admission',
    [ table({
        title: 'closes malformed campaign traffic',
        cases: [ 'body-string', 'header-string', 'large-header', 'receiver-failure', 'zero-header' ] as const,
        caseTitle(scenario) {
            return `closes malformed ${scenario} campaign traffic`;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = campaignFrameChannel(scenario);
            fixture.deliver();
            const error = await fixture.fault;
            scope.assert.true(fixture.socket.destroyed);
            scope.assert.equal(error.message, expectedMessages[scenario]);
            scope.assert.equal(error.cause, scenario === 'receiver-failure' ? 'receiver failed' : undefined);
            return scope.assert.collect();
        }
    }) ]
);
