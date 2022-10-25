export type TestFn = () => void;

export interface TestCaseDetails {
    readonly title: string;
    readonly index: number;
}

export interface TestCaseInput {
    readonly title: string;
    readonly testFn: TestFn;
}

export type TestCase = TestCaseDetails & TestCaseInput;
