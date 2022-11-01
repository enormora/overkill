import type { TestCase, TestCaseInput } from './test-case.js';

export interface Suite {
    readonly testCases: readonly TestCaseInput[];
    readonly title: string;
}

export function extractTestCases(suite: Suite): readonly TestCase[] {
    return suite.testCases.map((testCaseInput: TestCaseInput): TestCase => {
        return {
            ...testCaseInput,
            suiteTitle: suite.title,
        };
    });
}

export function createSuite(title: string, testCases: readonly TestCaseInput[]): Suite {
    return { title, testCases };
}
