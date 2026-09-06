import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createNullReporter } from './null-reporter.ts';

export const testSuite = createOverkillSuite({
    title: 'source/reporters/null-reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'null reporter accepts a final result without producing output',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createNullReporter();

                scope.assert.equal(reporter.kind, 'final-result');
                scope.assert.equal(reporter.name, 'null');
                scope.assert.deepEqual(reporter.sinks, []);

                await reporter.onResult(runResultFactory.build());

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
