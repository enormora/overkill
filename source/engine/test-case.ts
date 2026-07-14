export type TestFunction = () => Promise<void> | void;

export type TestCaseDetails = {
    readonly title: string;
    readonly suiteTitle: string;
    readonly index: number;
};

export type TestCaseDefinition = {
    readonly title: string;
    readonly testFunction: TestFunction;
};

export type TestCase = {
    readonly suiteTitle: string;
    readonly title: string;
    readonly testFunction: TestFunction;
};

export function createTestCase(title: string, testFunction: TestFunction): TestCaseDefinition {
    return { title, testFunction };
}
