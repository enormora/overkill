export type TestFn = () => void;

export interface TestCase {
  title: string;
  testFn: TestFn;
}
