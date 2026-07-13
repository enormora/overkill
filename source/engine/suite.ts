import type { TestCase, TestCaseInput } from './test-case.js';

export type Suite = {
    readonly testCases: readonly TestCaseInput[];
    readonly title: string;
};

export function extractTestCases(suite: Suite): readonly TestCase[] {
    return suite.testCases.map(function (testCaseInput: TestCaseInput): TestCase {
        return {
            ...testCaseInput,
            suiteTitle: suite.title
        };
    });
}

export function createSuite(title: string, testCases: readonly TestCaseInput[]): Suite {
    return { title, testCases };
}
