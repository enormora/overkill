import assert from 'node:assert/strict';
import { noop } from 'noop-esm';
import { registerTest } from '../test-support/register-test.ts';
import { executeSuite } from './execute-suite.ts';
import { createSuite } from './suite.ts';
import { createTestCase } from './test-case.ts';

function fail(): never {
    throw new Error('public failure');
}

registerTest('executeSuite() runs every test case in the given suite', async function () {
    const suite = createSuite('public-suite', [
        createTestCase('first', noop),
        createTestCase('second', noop)
    ]);

    const result = await executeSuite(suite);

    assert.deepStrictEqual(result, {
        progress: 'completed',
        summary: {
            totalCount: 2,
            failedCount: 0,
            successCount: 2,
            completedCount: 2,
            pendingCount: 0
        },
        testCaseResults: [
            {
                testCaseDetails: { title: 'first', index: 0, suiteTitle: 'public-suite' },
                result: { status: 'success', duration: result.testCaseResults[0]?.result.duration }
            },
            {
                testCaseDetails: { title: 'second', index: 1, suiteTitle: 'public-suite' },
                result: { status: 'success', duration: result.testCaseResults[1]?.result.duration }
            }
        ]
    });
});

registerTest('executeSuite() reports thrown errors as failed test results', async function () {
    const suite = createSuite('public-suite', [ createTestCase('fails', fail) ]);

    const result = await executeSuite(suite);

    assert.deepStrictEqual(result, {
        progress: 'completed',
        summary: {
            totalCount: 1,
            failedCount: 1,
            successCount: 0,
            completedCount: 1,
            pendingCount: 0
        },
        testCaseResults: [
            {
                testCaseDetails: { title: 'fails', index: 0, suiteTitle: 'public-suite' },
                result: {
                    status: 'failure',
                    reason: 'public failure',
                    duration: result.testCaseResults[0]?.result.duration
                }
            }
        ]
    });
});
