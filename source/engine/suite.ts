import type { TestCase, TestCaseDefinition } from './test-case.ts';

export type Suite = {
    readonly testCases: readonly TestCaseDefinition[];
    readonly title: string;
};

export function extractTestCases(suite: Suite): readonly TestCase[] {
    return suite.testCases.map(function (testCaseInput: TestCaseDefinition): TestCase {
        return {
            ...testCaseInput,
            suiteTitle: suite.title
        };
    });
}

export function createSuite(title: string, testCases: readonly TestCaseDefinition[]): Suite {
    return { title, testCases };
}
