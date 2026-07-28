import assert from 'node:assert/strict';
import type { FailedCheck, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { registerTest } from '../test-support/register-test.ts';
import { verdictFromOutcome, type TestOutcome } from './run-result.ts';

type FailedCheckFixture = {
    readonly actual: null;
    readonly expected: null;
    readonly id: FailedCheck['id'];
    readonly kind: 'leaf';
    readonly location: SourceLocation;
    readonly path: readonly string[];
    readonly source: FailedCheck['source'];
    readonly summary: FailedCheck['summary'];
};

function createFailedCheck(): FailedCheckFixture {
    return {
        actual: null,
        expected: null,
        id: 'check',
        kind: 'leaf',
        location: { column: null, file: 'source/example.test.ts', line: null },
        path: [],
        source: 'assert',
        summary: 'Check failed'
    };
}

registerTest('verdictFromOutcome() returns the outcome kind as the verdict', function () {
    const outcome: TestOutcome = {
        failures: [ { checks: [ createFailedCheck() ], kind: 'assertion' } ],
        kind: 'fail'
    };

    assert.equal(verdictFromOutcome(outcome), 'fail');
});
