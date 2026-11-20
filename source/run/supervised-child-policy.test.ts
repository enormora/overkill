import { table, type TestNode, suite } from '@overkill-dev/test';

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
export const testNode: TestNode = suite(
    'supervised child command policy',
    [ table({
        title: 'handles with selection and restrictions',
        cases: ([ 'collect', 'run' ] as const).flatMap(function (mode) {
            return [ false, true ].flatMap(function (selected) {
                const expectedStatus = selected ? 'passed' : 'failed';
                const expected = mode === 'collect'
                    ? { status: null, planned: null }
                    : { status: expectedStatus, planned: Number(selected) };
                return [ false, true ].map(function (restricted) {
                    return ({
                        caseDescription: `handles ${mode} with selection ${selected} and restrictions ${restricted}`,
                        mode,
                        selected,
                        expectedStatus,
                        expected,
                        restricted
                    });
                });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { mode, selected, expected, restricted } = scope.parameters;

            const fixture = memorySupervisedChild(mode, selected, restricted);
            await fixture.execute();
            scope.assert.equal(fixture.exitCode(), 0);
            scope.assert.equal(fixture.disconnected(), true);
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
    }) ]
);
