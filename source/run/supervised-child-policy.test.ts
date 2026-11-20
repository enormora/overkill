import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { memorySupervisedChild } from '../test-support/memory-supervised-child.ts';
import type { SupervisedChildMessage } from './supervised-protocol.ts';

function isRunnerError(message: SupervisedChildMessage): boolean {
    return message.kind === 'event' && message.event.kind === 'runner-error';
}
function isResult(
    message: SupervisedChildMessage
): message is Extract<SupervisedChildMessage, { readonly kind: 'result'; }> {
    return message.kind === 'result';
}
export const testNode = authoredSuite(
    'supervised child command policy',
    ([ 'collect', 'run' ] as const).flatMap(function (mode) {
        return [ false, true ].flatMap(function (selected) {
            const expectedStatus = selected ? 'passed' : 'failed';
            const expected = mode === 'collect'
                ? { status: null, planned: null }
                : { status: expectedStatus, planned: Number(selected) };
            return [ false, true ].map(function (restricted) {
                return test(
                    `handles ${mode} with selection ${selected} and restrictions ${restricted}`,
                    async function (scope: TestScope) {
                        const fixture = memorySupervisedChild(mode, selected, restricted);
                        await fixture.execute();
                        scope.assert.equal(fixture.exitCode(), 0);
                        scope.assert.equal(fixture.disconnected(), true);
                        scope.assert.deepEqual(
                            fixture.completion(),
                            mode === 'run'
                                ? [ 'coverage', 'result', 'disconnect' ]
                                : [ 'disconnect' ]
                        );
                        scope.assert.deepEqual(
                            fixture.messages().filter(isRunnerError),
                            []
                        );
                        const result = fixture.messages().find(isResult);
                        scope.assert.deepEqual({
                            status: result?.result.status ?? null,
                            planned: result?.result.summary.planned ?? null
                        }, expected);
                        return scope.assert.collect();
                    }
                );
            });
        });
    })
);
