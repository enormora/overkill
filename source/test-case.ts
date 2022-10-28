export type TestFunction = () => void | Promise<void>;

export interface TestCaseDetails {
    readonly title: string;
    readonly index: number;
}

export interface TestCaseInput {
    readonly title: string;
    readonly testFunction: TestFunction;
}

export type TestCase = TestCaseDetails & TestCaseInput;
