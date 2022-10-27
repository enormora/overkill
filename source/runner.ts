import type { SuiteResult } from './suite.js';
import type { TestCase, TestCaseInput } from './test-case.js';
import type { TestRunSessionProvider } from './test-run-session.js';

export interface RunnerDependencies {
    readonly testRunSessionProvider: TestRunSessionProvider;
}

export interface Runner {
    addTestCase(testCaseInput: TestCaseInput): void;
    runAll(): Promise<SuiteResult>;
}

export function createRunner(dependencies: RunnerDependencies): Runner {
    const { testRunSessionProvider } = dependencies;
    const testCases: TestCase[] = [];
    let runCount = -1;

    return {
        addTestCase({ title, testFn }) {
            const testCase = {
                title,
                index: testCases.length,
                testFn,
            };

            testCases.push(testCase);
        },

        async runAll() {
            runCount += 1;

            const testRunSession = testRunSessionProvider.createTestRunSession(runCount, testCases.length);

            await testRunSession.start();
            const testCaseResults = await Promise.all(testCases.map(testRunSession.runSingleTestCase));
            return testRunSession.done(testCaseResults);
        },
    };
}
