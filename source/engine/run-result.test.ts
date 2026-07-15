import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import type { FailedCheck, SourceLocation } from './test-node.ts';
import { verdictFromOutcome, type TestOutcome } from './run-result.ts';

type FailedCheckFixture = {
    readonly actual: null;
    readonly expected: null;
    readonly id: FailedCheck['id'];
    readonly location: SourceLocation;
    readonly path: readonly string[];
    readonly summary: FailedCheck['summary'];
};

function createFailedCheck(): FailedCheckFixture {
    return {
        actual: null,
        expected: null,
        id: 'check',
        location: { column: null, file: 'source/example.test.ts', line: null },
        path: [],
        summary: 'Check failed'
    };
}

registerTest('verdictFromOutcome() returns the outcome kind as the verdict', function () {
    const outcome: TestOutcome = { checks: [ createFailedCheck() ], kind: 'fail' };

    assert.equal(verdictFromOutcome(outcome), 'fail');
});
