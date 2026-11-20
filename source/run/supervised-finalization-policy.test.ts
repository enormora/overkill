import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { supervisedMessageRuntime } from '../test-support/supervised-message-runtime.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { finishSupervisedRuntime } from './supervised-run-runtime.ts';

export const testNode = authoredSuite('supervised result finalization', [
    ...[ false, true ].flatMap(function (collected) {
        return [ false, true ].map(function (completed) {
            return test(
                `finalizes with collection ${collected} and child result ${completed}`,
                async function (scope: TestScope) {
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
            );
        });
    }),
    ...[ false, true ].flatMap(function (completed) {
        return [ false, true ].map(function (terminal) {
            return test(
                `retains child exit with completed result ${completed} and terminal policy ${terminal}`,
                async function (scope: TestScope) {
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
            );
        });
    })
]);
