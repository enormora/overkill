import assert from 'node:assert/strict';
import { createFactory } from '@enormora/objectory';
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

type TestOutcomeFixture = {
    readonly checks: readonly FailedCheckFixture[];
    readonly kind: TestOutcome['kind'];
    readonly reason: null;
};

const sourceLocationFactory = createFactory<SourceLocation>(function createSourceLocation() {
    return {
        column: null,
        file: 'source/example.test.ts',
        line: null
    };
});

const failedCheckFactory = createFactory<FailedCheckFixture>(function createFailedCheck() {
    return {
        actual: null,
        expected: null,
        id: 'check',
        location: sourceLocationFactory,
        path: [] as readonly string[],
        summary: 'Check failed'
    };
});

const testOutcomeFactory = createFactory<TestOutcomeFixture>(function createTestOutcome() {
    return {
        checks: failedCheckFactory.asArray({ length: 0 }),
        kind: 'pass',
        reason: null
    };
});

registerTest('verdictFromOutcome() returns the outcome kind as the verdict', function () {
    assert.equal(verdictFromOutcome(testOutcomeFactory.build({ kind: 'fail' })), 'fail');
});
