import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { createInMemoryFinalResultReporter, createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createPlainOutputRenderer } from './reporter-output.ts';
import { defineReporter, type DefinedReporter, type Reporter } from './reporter.ts';
import { createDeliveryReportingContext, prepareReporterDelivery } from './reporter-delivery-preparation.ts';

function deliveredReporters(final: boolean, kind: 'empty' | 'final' | 'live'): readonly string[] {
    const reporters: Reporter[] = [];
    const definitions: readonly DefinedReporter[] = kind === 'empty'
        ? []
        : [ kind === 'final' ? createInMemoryFinalResultReporter() : createInMemoryRealTimeReporter() ];
    const options = {
        definitions,
        renderer: createPlainOutputRenderer(),
        final: final ? { facts: { value: 42 }, fallback: createInMemoryFinalResultReporter() } : null
    };
    return prepareReporterDelivery(
        {
            addReporter(reporter) {
                reporters.push(reporter);
            },
            reporters() {
                return reporters;
            }
        },
        options,
        createDeliveryReportingContext(options.final)
    )
        .reporters
        .map(function (reporter) {
            return reporter.name;
        });
}
export const testNode = authoredSuite('final result reporter preparation', [
    ...[ false, true ].flatMap(function (final) {
        return ([ 'empty', 'final', 'live' ] as const).map(function (kind) {
            const ordinary = kind === 'empty'
                ? []
                : [ kind === 'final' ? 'in-memory-final-result' : 'in-memory-real-time' ];
            const expected = final ? [ 'in-memory-final-result' ] : ordinary;
            return authoredTest(
                `selects ${kind} reporter definitions for final delivery ${final}`,
                function (scope: TestScope) {
                    scope.assert.deepEqual(deliveredReporters(final, kind), expected);
                    return scope.assert.collect();
                }
            );
        });
    }),
    authoredTest('validates required facts before final result delivery', function (scope: TestScope) {
        const reporters: Reporter[] = [];
        const reporting = createDeliveryReportingContext({
            facts: { value: 42 },
            fallback: createInMemoryFinalResultReporter()
        });
        const definition = defineReporter({
            createReporter: createInMemoryFinalResultReporter(),
            validateRunFacts(facts) {
                if (facts.value !== 42) {
                    throw new TypeError('Missing required fact.');
                }
            }
        });
        scope.assert.throws(function () {
            prepareReporterDelivery({
                addReporter(reporter) {
                    reporters.push(reporter);
                },
                reporters() {
                    return reporters;
                }
            }, {
                definitions: [ definition ],
                renderer: createPlainOutputRenderer(),
                final: { facts: {}, fallback: createInMemoryFinalResultReporter() }
            }, reporting);
        }, { message: 'Missing required fact.' });
        return scope.assert.collect();
    })
]);
