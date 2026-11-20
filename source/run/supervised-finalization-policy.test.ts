import { table, type TestNode, suite } from '@overkill-dev/test';

import { supervisedMessageRuntime } from '../test-support/supervised-message-runtime.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { finishSupervisedRuntime } from './supervised-run-runtime.ts';

export const testNode: TestNode = suite('supervised result finalization', [
    table({
        title: 'finalizes according to available collection and result evidence',
        cases: [ false, true ].flatMap(function (collected) {
            return [ false, true ].map(function (completed) {
                return { collected, completed };
            });
        }),
        caseTitle({ collected, completed }) {
            return [ collected, completed ].map(String).join(', ');
        },
        async test(scope) {
            const { collected, completed } = scope.parameters;

            const fixture = supervisedMessageRuntime(scope, false, collected);
            if (completed) {
                fixture.receive({
                    kind: 'result',
                    result: runResultFactory.build({ runnerErrors: [ { message: 'child error' } ] })
                });
            }
            const result = await finishSupervisedRuntime(fixture.runtime, 0);
            scope.assert.deepEqual(
                result.runnerErrors.map(function (error) {
                    return error.message;
                }),
                completed ? [ 'child error' ] : []
            );
            scope.assert.equal(result.status, completed ? 'failed' : 'passed');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'retains child exits according to terminal policy',
        cases: [ false, true ].flatMap(function (completed) {
            return [ false, true ].map(function (terminal) {
                return { completed, terminal };
            });
        }),
        caseTitle({ completed, terminal }) {
            return [ completed, terminal ].map(String).join(', ');
        },
        async test(scope) {
            const { completed, terminal } = scope.parameters;

            const fixture = supervisedMessageRuntime(scope, false, true);
            if (completed) {
                fixture.receive({ kind: 'result', result: runResultFactory.build({}) });
            }
            fixture.runtime.terminalFailure.write(terminal);
            const result = await finishSupervisedRuntime({
                ...fixture.runtime,
                child: {
                    ...fixture
                        .runtime
                        .child,
                    exitCode: 1,
                    signalCode: null
                }
            }, 0);
            scope.assert.deepEqual(
                result.runnerErrors.map(function (error) {
                    return error.subtype;
                }),
                completed || terminal ? [] : [ 'crash' ]
            );
            return scope.assert.collect();
        }
    })
]);
