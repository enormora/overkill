import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
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
    readonly path: FailedCheck['path'];
    readonly source: FailedCheck['source'];
    readonly sourceLocations: readonly [SourceLocation];
    readonly summary: FailedCheck['summary'];
};

function createFailedCheck(): FailedCheckFixture {
    return {
        actual: serializeValue(null),
        diff: null,
        expected: serializeValue(null),
        id: 'check',
        kind: 'leaf',
        path: [],
        source: 'assert',
        sourceLocations: [ { column: null, file: 'source/example.test.ts', kind: 'known' as const, line: null } ],
        summary: 'Check failed'
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/run-result.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'verdictFromOutcome() returns the outcome kind as the verdict',
            annotations: {},
            controls: {},
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
