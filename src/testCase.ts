export type TestFn = () => void;

export interface TestCaseDetails {
  title: string;
}

export interface TestCase extends TestCaseDetails {
  testFn: TestFn;
}
