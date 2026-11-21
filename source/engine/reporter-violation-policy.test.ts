import { table, suite, testDouble } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { defineFixedReporter } from '../test-support/reporter-definition.ts';

import { createReporterDispatcher } from './reporter-dispatcher.ts';
import { createPlainOutputRenderer } from './reporter-output.ts';
import { recordReporterConsoleDiagnostic } from './reporter-output-scope.ts';

export const testNode = suite(
    'reporter output violation classification',
    [ table({
        title: 'rejects undeclared console output',
        cases: [ false, true ],
        caseTitle(disposing) {
            return disposing ? 'disposal' : 'event delivery';
        },
        async test(scope) {
            const disposing = scope.parameters;

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
    }) ]
);
