import { type TestScope, test, suite as authoredSuite, testDouble } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { defineFixedReporter } from '../test-support/reporter-definition.ts';

import { createReporterDispatcher } from './reporter-dispatcher.ts';
import { createPlainOutputRenderer } from './reporter-output.ts';
import { recordReporterConsoleDiagnostic } from './reporter-output-scope.ts';

export const testNode = authoredSuite(
    'reporter output violation classification',
    [ false, true ].map(function (disposing) {
        return test(
            `classifies undeclared reporter output during disposal ${disposing}`,
            async function (scope: TestScope) {
                const writeLine = testDouble.returns(undefined);
                const dispatcher = createReporterDispatcher({
                    wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
                    stdout: { writeLine },
                    stderr: { writeLine }
                });
                const violate = function (): undefined {
                    recordReporterConsoleDiagnostic('console.log');
                    return undefined;
                };
                const reporter = defineFixedReporter({
                    kind: 'real-time' as const,
                    name: 'restricted',
                    sinks: [],
                    onFinish: null,
                    onEvent: disposing
                        ? testDouble.returns(undefined)
                        : violate,
                    dispose: disposing ? violate : null
                });
                const delivery = await dispatcher.createDelivery([ reporter ], createPlainOutputRenderer());
                const errors = disposing
                    ? await delivery.disposeReporters()
                    : await delivery.reportEvent({ kind: 'suite-start', suitePath: [] });
                scope.assert.partialDeepEqual(errors, [ {
                    subtype: 'reporter',
                    message: 'restricted: Reporter used undeclared console.log output.'
                } ]);
                await delivery.disposeReporters();
                return scope.assert.collect();
            }
        );
    })
);
