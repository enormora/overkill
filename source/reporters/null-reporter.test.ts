import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { createReportingContext } from '../engine/reporting-context.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createNullReporter } from './null-reporter.ts';

export const testNode = suite('source/reporters/null-reporter.test.ts', [
    test('null reporter accepts a final result without producing output', async function (scope: OverkillScope) {
        const reporter = createNullReporter()(createReportingContext({ projectRoot: null }));

        scope.assert.equal(reporter.kind, 'final-result');
        scope.assert.equal(reporter.name, 'null');
        scope.assert.deepEqual(reporter.sinks, []);

        await reporter.onResult({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResultFactory.build()
        });

        return scope.assert.collect();
    })
]);
