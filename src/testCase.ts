export type TestFn = () => void;

export interface TestCaseDetails {
  title: string;
  index: number;
}

export interface TestCaseInput {
  title: string;
  testFn: TestFn;
}

export type TestCase = TestCaseDetails & TestCaseInput;
