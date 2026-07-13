import type { TestRunResult } from './test-run-result.ts';
import type { TestRunSessionProvider } from './test-run-session.ts';
import { extractTestCases, type Suite } from './suite.ts';

export type RunnerDependencies = {
    readonly testRunSessionProvider: TestRunSessionProvider;
};

export type Runner = {
    addSuite: (suite: Suite) => void;
    runAll: () => Promise<TestRunResult>;
};

export function createRunner(dependencies: RunnerDependencies): Runner {
    const { testRunSessionProvider } = dependencies;
    const suites: Suite[] = [];
    let runCount = -1;

    return {
        addSuite(suite) {
            suites.push(suite);
        },

        async runAll() {
            runCount += 1;

            const testCases = suites.flatMap(extractTestCases);

            const testRunSession = testRunSessionProvider.createTestRunSession(runCount, testCases.length);

            await testRunSession.start();
            const testCaseResults = await Promise.all(testCases.map(testRunSession.runSingleTestCase));
            return testRunSession.done(testCaseResults);
        }
    };
}
