import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { FailedCheck, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { verdictFromOutcome, type TestOutcome } from './run-result.ts';

type FailedCheckFixture = {
    readonly actual: FailedCheck['actual'];
    readonly diff: null;
    readonly expected: FailedCheck['expected'];
    readonly id: FailedCheck['id'];
    readonly kind: 'leaf';
    readonly location: SourceLocation;
    readonly path: FailedCheck['path'];
    readonly source: FailedCheck['source'];
    readonly summary: FailedCheck['summary'];
};

function createFailedCheck(): FailedCheckFixture {
    return {
        actual: serializeValue(null),
        diff: null,
        expected: serializeValue(null),
        id: 'check',
        kind: 'leaf',
        location: { column: null, file: 'source/example.test.ts', line: null },
        path: [],
        source: 'assert',
        summary: 'Check failed'
    };
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/run-result.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'verdictFromOutcome() returns the outcome kind as the verdict',
            metadata: {},
            body(scope: OverkillScope) {
                const outcome: TestOutcome = {
                    failures: [ { checks: [ createFailedCheck() ], kind: 'assertion' } ],
                    kind: 'fail'
                };

                scope.assert.equal(verdictFromOutcome(outcome), 'fail');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
