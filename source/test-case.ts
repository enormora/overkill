export type TestFunction = () => void | Promise<void>;

export interface TestCaseDetails {
    readonly title: string;
    readonly suiteTitle: string;
    readonly index: number;
}

export interface TestCaseInput {
    readonly title: string;
    readonly testFunction: TestFunction;
}

export type TestCase = TestCaseInput & Omit<TestCaseDetails, 'index'>;
